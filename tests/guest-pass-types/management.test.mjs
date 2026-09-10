import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import sql from '../../db/SqlConnector.js';
import redis from '../../db/RedisConnector.js';
import router from '../../guest-pass-types/api.js';
import errorHandler from '../../utils/errorHandler.js';

const endpoint = '/guest-pass-types';
const payload = { label: 'Afternoon', cost: 1250, valid: 2, limit: 4, settings: { play_after: '12:00' } };
function appFor(role = 4000, userauth = true) {
  const app = express();
  app.use((_req, res, next) => { Object.assign(res.locals, { role, userauth }); next(); });
  app.use(endpoint, router);
  app.use(errorHandler);
  return app;
}

describe('guest pass type management', () => {
  const original = { withConnection: sql.withConnection, runExecute: sql.runExecute, runQuery: sql.runQuery };
  const originalDelete = redis.deleteKey;
  let rows, settings, writes, failSettings, commits, rollbacks, snapshot, invalidations;
  beforeEach(() => {
    rows = [{ id: 7, club_id: process.env.CLUB_ID, label: 'Day pass', cost: 1000, valid_days: 1, season_limit: 0 }];
    settings = new Map(); writes = 0; failSettings = false; commits = 0; rollbacks = 0;
    invalidations = [];
    redis.deleteKey = async key => { expect(commits).to.be.greaterThan(0); invalidations.push(key); };
    const connection = {
      async beginTransaction() { snapshot = { rows: structuredClone(rows), settings: new Map(settings) }; },
      async commit() { commits++; },
      async rollback() { rows = snapshot.rows; settings = snapshot.settings; rollbacks++; },
    };
    sql.withConnection = async work => work(connection);
    sql.runExecute = async (_conn, query, values) => {
      if (query.startsWith('SELECT id')) {
        return rows.filter(row => row.id === values[0] && row.club_id === values[1]);
      }
      if (/SELECT\s+id,/.test(query)) return rows.filter(row => row.club_id === values[0]);
      if (query.startsWith('INSERT INTO guest_pass_type (')) {
        const [club_id, label, cost, valid_days, season_limit] = values;
        rows.push({ id: 8, club_id, label, cost, valid_days, season_limit });
        writes++; return { insertId: 8 };
      }
      if (query.startsWith('UPDATE guest_pass_type')) {
        const [label, cost, valid_days, season_limit, id, club] = values;
        const row = rows.find(row => row.id === id && row.club_id === club);
        Object.assign(row, { label, cost, valid_days, season_limit }); writes++;
        return { affectedRows: 1 };
      }
      if (query.includes('guest_pass_type_setting')) {
        if (failSettings) throw new Error('Settings write failed');
        if (query.startsWith('DELETE')) settings.delete(`${values[0]}:${values[1]}`);
        else settings.set(`${values[0]}:${values[1]}`, values[2]);
        writes++; return { affectedRows: 1 };
      }
      throw new Error(`Unexpected SQL: ${query}`);
    };
    sql.runQuery = async (_conn, query, values) => [...settings].map(([key, setting_value]) => {
      const [id, setting_key] = key.split(':');
      return { pass_type: Number(id), setting_key, setting_value };
    }).filter(row => !query.includes('WHERE pass_type = ?') || row.pass_type === values[0]);
  });
  afterEach(() => { Object.assign(sql, original); redis.deleteKey = originalDelete; });

  it('creates a pass type and returns the same rules on catalog reload', async () => {
    const created = await request(appFor()).post(endpoint).send(payload).expect(201);
    expect(created.body).to.include({ id: 8, label: 'Afternoon', cost: 1250, valid: 2, limit: 4 });
    expect(created.body.constraints).to.deep.equal([{ key: 'play_after', text: 'Play at or after 12:00' }]);
    const listed = await request(appFor()).get(endpoint).expect(200);
    expect(listed.headers['cache-control']).to.equal('no-store');
    expect(listed.body.find(pass => pass.id === 8)).to.deep.equal(created.body);
    expect(commits).to.equal(1);
  });

  it('updates an existing type and removes the play-time restriction', async () => {
    settings.set('7:play_after', '14:00');
    const data = { ...payload, cost: 0, limit: 0, settings: { play_after: null, allowed_days: null } };
    const response = await request(appFor()).put(`${endpoint}/7`).send(data).expect(200);
    expect(response.body).to.deep.equal({ id: 7, ...data, constraints: [] });
    expect(settings.has('7:play_after')).to.equal(false);
    expect(rows).to.have.length(1);
    expect(invalidations).to.deep.equal([`active_persons_${process.env.CLUB_ID}`]);
  });

  it('rejects invalid values and extra settings without any writes', async () => {
    for (const body of [
      { ...payload, label: ' ' }, { ...payload, label: 'a'.repeat(33) },
      { ...payload, cost: -1 }, { ...payload, cost: 12.5 }, { ...payload, cost: '1250' },
      { ...payload, valid: 0 }, { ...payload, valid: 1.5 }, { ...payload, limit: -1 },
      { ...payload, settings: { play_after: '24:00' } },
      { ...payload, settings: { play_after: null, invented_rule: true } },
      { ...payload, club_id: 999 },
    ]) await request(appFor()).post(endpoint).send(body).expect(422);
    for (const id of ['0', '-1', '1.2', '2147483648', 'abc']) {
      await request(appFor()).put(`${endpoint}/${id}`).send(payload).expect(422);
    }
    expect(writes).to.equal(0);
  });

  it('persists day and time rules together, preserves omitted days, and clears explicit null', async () => {
    const data = { ...payload, settings: { play_after: '12:00', allowed_days: [5, 1, 3] } };
    const created = await request(appFor()).post(endpoint).send(data).expect(201);
    expect(created.body.settings).to.deep.equal({ play_after: '12:00', allowed_days: [1, 3, 5] });
    expect(created.body.constraints).to.deep.equal([
      { key: 'play_after', text: 'Play at or after 12:00' },
      { key: 'allowed_days', text: 'Play on Monday, Wednesday, Friday only' },
    ]);
    const listed = await request(appFor()).get(endpoint).expect(200);
    expect(listed.body.find(pass => pass.id === 8)).to.deep.equal(created.body);
    expect(settings.get('8:allowed_days')).to.equal('[1,3,5]');
    const updated = await request(appFor()).put(`${endpoint}/8`).send(payload).expect(200);
    expect(updated.body.settings.allowed_days).to.deep.equal([1, 3, 5]);
    const cleared = await request(appFor()).put(`${endpoint}/8`)
      .send({ ...payload, settings: { play_after: '12:00', allowed_days: null } }).expect(200);
    expect(cleared.body.settings.allowed_days).to.equal(null);
    expect(settings.has('8:allowed_days')).to.equal(false);
    expect(cleared.body.constraints).to.have.length(1);
  });

  it('rejects empty, duplicate, fractional, and out-of-range playing days without writes', async () => {
    for (const allowed_days of [[], [0], [8], [1.5], ['1'], [1, 1], [1, 2, 3, 4, 5, 6, 6], 'Monday', true, {}]) {
      await request(appFor()).post(endpoint)
        .send({ ...payload, settings: { play_after: null, allowed_days } }).expect(422);
    }
    expect(writes).to.equal(0);
  });

  it('normalizes full-week creates and updates to null and removes an existing restriction', async () => {
    const data = { ...payload, settings: { play_after: null, allowed_days: [7, 6, 5, 4, 3, 2, 1] } };
    const created = await request(appFor()).post(endpoint).send(data).expect(201);
    expect(created.body.settings).to.deep.equal({ play_after: null, allowed_days: null });
    expect(created.body.constraints).to.deep.equal([]);
    expect(settings.has('8:allowed_days')).to.equal(false);

    settings.set('7:allowed_days', '[1,3,5]');
    const updated = await request(appFor()).put(`${endpoint}/7`).send(data).expect(200);
    expect(updated.body.settings).to.deep.equal(created.body.settings);
    expect(updated.body.constraints).to.deep.equal([]);
    expect(settings.has('7:allowed_days')).to.equal(false);
    const listed = await request(appFor()).get(endpoint).expect(200);
    expect(listed.body.find(pass => pass.id === 7)).to.deep.equal(updated.body);
  });

  it('allows catalog reads but denies non-administrator writes and unauthenticated requests', async () => {
    await request(appFor(2000)).get(endpoint).expect(200);
    for (const app of [appFor(2000), appFor(3000), appFor(4000, false)]) {
      await request(app).post(endpoint).send(payload).expect(401);
      await request(app).put(`${endpoint}/7`).send(payload).expect(401);
    }
    await request(appFor(4000, false)).get(endpoint).expect(401);
    expect(writes).to.equal(0);
  });

  it('cannot update a pass type belonging to another club', async () => {
    rows[0].club_id = 'another-club';
    await request(appFor()).put(`${endpoint}/7`).send(payload).expect(404);
    expect(writes).to.equal(0);
  });

  it('rolls back both creation and edits when rule persistence fails', async () => {
    failSettings = true;
    const before = structuredClone(rows);
    await request(appFor()).post(endpoint).send(payload).expect(500);
    expect(rows).to.deep.equal(before);
    await request(appFor()).put(`${endpoint}/7`).send(payload).expect(500);
    expect(rows).to.deep.equal(before);
    expect(commits).to.equal(0);
    expect(rollbacks).to.equal(2);
    expect(invalidations).to.deep.equal([]);
  });

  it('does not report a committed update as failed when Redis is unavailable', async () => {
    redis.deleteKey = async () => { throw new Error('Cache unavailable'); };
    await request(appFor()).put(`${endpoint}/7`).send(payload).expect(200);
    expect(rows[0].label).to.equal('Afternoon');
    expect(commits).to.equal(1);
  });

  it('returns an empty catalog so administrators can create the first type', async () => {
    rows = [];
    const response = await request(appFor()).get(endpoint).expect(200);
    expect(response.body).to.deep.equal([]);
  });
});
