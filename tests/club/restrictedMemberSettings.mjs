import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import sql from '../../db/SqlConnector.js';
import router from '../../club/api.js';
import errorHandler from '../../utils/errorHandler.js';

const endpoint = '/club/restricted-member-roles';
const club = process.env.CLUB_ID;
const payload = { settings: { play_after: '12:00', allowed_days: [5, 1, 3] } };
function appFor(role = 4000, userauth = true) {
  const app = express();
  app.use((_req, res, next) => { Object.assign(res.locals, { role, userauth }); next(); });
  app.use('/club', router);
  app.use(errorHandler);
  return app;
}

describe('restricted member role settings', () => {
  const original = { withConnection: sql.withConnection, runExecute: sql.runExecute, runQuery: sql.runQuery };
  let roles, settings, writes, failKey, commits, rollbacks;
  const keyFor = (clubId, role, key) => `${clubId}:${role}:${key}`;
  beforeEach(() => {
    roles = [{ id: 1000, label: 'Afternoon', type: 200 }, { id: 1500, label: 'Junior', type: 200 }, { id: 2000, label: 'Member', type: 300 }];
    settings = new Map(); writes = 0; failKey = null; commits = 0; rollbacks = 0;
    let snapshot;
    const connection = {
      async beginTransaction() { snapshot = new Map(settings); },
      async commit() { commits++; },
      async rollback() { settings = snapshot; rollbacks++; },
    };
    sql.withConnection = async work => work(connection);
    sql.runExecute = async (_conn, query, values) => {
      if (query.startsWith('SELECT')) {
        const updating = query.includes('WHERE id = ?');
        return roles.filter(role => role.type === values[updating ? 1 : 0] && (!updating || role.id === values[0]))
          .map(({ id, label }) => ({ id, label }));
      }
      expect(query).to.include('club_role_setting');
      expect(values[0]).to.equal(club);
      const [clubId, role, key, value] = values;
      if (key === failKey) throw new Error('Settings unavailable');
      if (query.startsWith('DELETE')) settings.delete(keyFor(clubId, role, key));
      else settings.set(keyFor(clubId, role, key), value);
      writes++;
      return { affectedRows: 1 };
    };
    sql.runQuery = async (_conn, query, values) => {
      expect(query).to.include('WHERE club = ? AND role IN ?');
      expect(values[0]).to.equal(club);
      return [...settings].flatMap(([key, setting_value]) => {
        const [clubId, role, setting_key] = key.split(':');
        return clubId === String(values[0]) && values[1][0].includes(Number(role))
          ? [{ role: Number(role), setting_key, setting_value }] : [];
      });
    };
  });
  afterEach(() => Object.assign(sql, original));

  it('lists every restricted role, with unrestricted defaults and no other role types', async () => {
    const response = await request(appFor()).get(endpoint).expect(200);
    expect(response.headers['cache-control']).to.equal('no-store');
    expect(response.body.map(role => role.id)).to.deep.equal([1000, 1500]);
    expect(response.body[0].settings).to.deep.equal({ play_after: null, allowed_days: null });
    expect(response.body[0].constraints).to.deep.equal([]);
  });

  it('persists normalized rules separately per role and club, and reloads them', async () => {
    settings.set(keyFor('another-club', 1000, 'play_after'), '09:00');
    const response = await request(appFor()).put(`${endpoint}/1000`).send(payload).expect(200);
    expect(response.body.settings).to.deep.equal({ play_after: '12:00', allowed_days: [1, 3, 5] });
    expect(response.body.constraints).to.deep.equal([
      { key: 'play_after', text: 'Play at or after 12:00' },
      { key: 'allowed_days', text: 'Play on Monday, Wednesday, Friday only' },
    ]);
    const listed = await request(appFor()).get(endpoint).expect(200);
    expect(listed.body[0]).to.deep.equal(response.body);
    expect(listed.body[1].settings.play_after).to.equal(null);
    expect(settings.get(keyFor('another-club', 1000, 'play_after'))).to.equal('09:00');
    expect(commits).to.equal(1);
  });

  it('clears limits and treats all seven days as unrestricted', async () => {
    await request(appFor()).put(`${endpoint}/1000`).send(payload).expect(200);
    const response = await request(appFor()).put(`${endpoint}/1000`)
      .send({ settings: { play_after: null, allowed_days: [7, 6, 5, 4, 3, 2, 1] } }).expect(200);
    expect(response.body.settings).to.deep.equal({ play_after: null, allowed_days: null });
    expect(response.body.constraints).to.deep.equal([]);
    expect(settings.size).to.equal(0);
  });

  it('rejects invalid settings and ids before writing', async () => {
    for (const settings of [
      { play_after: '24:00', allowed_days: null },
      { play_after: 'noon', allowed_days: null },
      { play_after: null },
      { play_after: null, allowed_days: null, unknown: true },
      ...[[], [1, 1], [0], [8], ['1'], [1.5], 'Monday'].map(allowed_days => ({ play_after: null, allowed_days })),
    ]) await request(appFor()).put(`${endpoint}/1000`).send({ settings }).expect(422);
    await request(appFor()).put(`${endpoint}/1000`).send({ ...payload, club: 2 }).expect(422);
    for (const id of ['0', '-1', 'abc', '1.5', '2147483648']) {
      await request(appFor()).put(`${endpoint}/${id}`).send(payload).expect(422);
    }
    expect(writes).to.equal(0);
  });

  it('does not edit missing roles or roles outside the restricted member type', async () => {
    for (const id of [999, 2000]) await request(appFor()).put(`${endpoint}/${id}`).send(payload).expect(404);
    expect(writes).to.equal(0);
  });

  it('requires an authenticated administrator for reads and writes', async () => {
    for (const app of [appFor(2000), appFor(3000), appFor(4000, false)]) {
      await request(app).get(endpoint).expect(401);
      await request(app).put(`${endpoint}/1000`).send(payload).expect(401);
    }
    expect(writes).to.equal(0);
  });

  it('rolls back the time change if saving days fails', async () => {
    settings.set(keyFor(club, 1000, 'play_after'), '09:00');
    failKey = 'allowed_days';
    await request(appFor()).put(`${endpoint}/1000`).send(payload).expect(500);
    expect(settings.get(keyFor(club, 1000, 'play_after'))).to.equal('09:00');
    expect(commits).to.equal(0);
    expect(rollbacks).to.equal(1);
  });
});
