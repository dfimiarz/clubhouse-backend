import assert from 'node:assert/strict';
import { expect } from 'chai';
import sql from '../../db/SqlConnector.js';
import processors from '../../bookings/processor.js';

describe('restricted member rules when moving bookings', () => {
  const original = { withConnection: sql.withConnection, runQuery: sql.runQuery, runExecute: sql.runExecute };
  let active, inserted, restriction, commits, rollbacks;
  const hash = 'a'.repeat(32);
  beforeEach(() => {
    active = 1; inserted = 0; commits = 0; rollbacks = 0;
    restriction = { play_after: '12:00' };
    let snapshot;
    sql.withConnection = async work => work({
      async query(query) { expect(query).to.equal('START TRANSACTION READ WRITE'); snapshot = active; },
      async beginTransaction() { snapshot = active; },
      async commit() { commits++; },
      async rollback() { active = snapshot; rollbacks++; },
    });
    sql.runExecute = async (_conn, query) => {
      expect(query).to.include('UPDATE activity SET active = 0');
      active = 0;
      return { affectedRows: 1 };
    };
    sql.runQuery = async (_conn, query, values) => {
      if (query.includes('a.id = ? and cl.id = ?')) return [{
        id: 1, active, etag: hash, court_id: 1, club_id: process.env.CLUB_ID,
        date: '2026-09-14', start: '11:00:00', end: '13:00:00', type: 1000,
        group_id: 1, utc_start: 11 * 3600, utc_end: 13 * 3600, utc_req_time: 10 * 3600,
      }];
      if (/FROM\s+participant\s+JOIN/.test(query)) return [{ person_id: 10, firstname: 'Jane', lastname: 'Doe', player_type_id: 1000 }];
      if (query.includes('FROM club_setting')) return [];
      if (query.includes('SELECT id FROM person')) return [{ id: 10 }];
      if (query.includes('FROM activity_supported')) return [{ supported: 1 }];
      if (query.includes('AS booking_type_desc')) return [{ group_id: 1, same_day_only: 0 }];
      if (query.includes('AS schedule_id')) {
        const minutes = time => { const [h, m] = time.split(':').map(Number); return h * 3600 + m * 60; };
        return [{ utc_start: minutes(values.start), utc_end: minutes(values.end), utc_req_time: 10 * 3600, schedule_id: 1 }];
      }
      if (query.includes('rt.requires_pass = 1')) return [];
      if (query.includes('r.type = ?')) return [{ id: 10, firstname: 'Jane', lastname: 'Doe', role_id: 1500, role_label: 'Junior' }];
      if (query.includes('FROM club_role_setting')) return Object.entries(restriction).map(([setting_key, value]) => ({
        role: 1500, setting_key, setting_value: Array.isArray(value) ? JSON.stringify(value) : value,
      }));
      if (query.startsWith('INSERT INTO `activity`')) { inserted++; return { insertId: 2 }; }
      if (query.includes('INSERT INTO participant')) return { affectedRows: 1 };
      if (query.includes('FOR UPDATE')) return [];
      throw new Error(`Unexpected SQL: ${query}`);
    };
  });
  afterEach(() => Object.assign(sql, original));

  it('rejects an early time change and restores the original booking', async () => {
    await assert.rejects(processors.changeSessionTime(1, { hash, start: '11:30', end: '12:30' }), {
      status: 422, payload: "Jane Doe's Junior membership does not allow play before 12:00.",
    });
    expect(active).to.equal(1);
    expect(inserted).to.equal(0);
    expect(rollbacks).to.equal(1);
    expect(commits).to.equal(0);
  });

  it('accepts a time change at the earliest permitted start', async () => {
    await processors.changeSessionTime(1, { hash, start: '12:00', end: '13:00' });
    expect(active).to.equal(0);
    expect(inserted).to.equal(1);
    expect(commits).to.equal(1);
  });

  it('rechecks allowed days on court changes and restores the original booking', async () => {
    restriction = { allowed_days: [6, 7] };
    await assert.rejects(processors.changeCourt(1, { hash, court: 2 }), {
      status: 422, payload: "Jane Doe's Junior membership does not allow play on Monday.",
    });
    expect(active).to.equal(1);
    expect(inserted).to.equal(0);
    expect(rollbacks).to.equal(1);
  });
});
