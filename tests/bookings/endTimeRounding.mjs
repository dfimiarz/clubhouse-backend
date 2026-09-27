import { expect } from 'chai';
import sql from '../../db/SqlConnector.js';
import processors from '../../bookings/processor.js';

const hms = (h, m, s = 0) => h * 3600 + m * 60 + s;

describe('early end times round down to the minute', () => {
  const original = { withConnection: sql.withConnection, runQuery: sql.runQuery, runExecute: sql.runExecute };
  const hash = 'a'.repeat(32);
  let row, executes, scheduleStarts;

  beforeEach(() => {
    executes = []; scheduleStarts = [];
    row = {
      id: 1, active: 1, etag: hash, court_id: 1, club_id: process.env.CLUB_ID,
      date: '2026-09-14', start: '10:00:00', end: '12:00:00', type: 1000, group_id: 1,
      utc_start: hms(10, 0), utc_end: hms(12, 0),
      utc_req_time: hms(11, 37, 22), loc_req_time: '11:37:22',
    };
    sql.withConnection = async work => work({
      async query() {},
      async beginTransaction() {},
      async commit() {},
      async rollback() {},
    });
    sql.runExecute = async (_conn, query, values) => {
      if (query.includes('FROM club_setting')) return [];
      executes.push({ query, values });
      return { affectedRows: 1 };
    };
    sql.runQuery = async (_conn, query, values) => {
      if (query.includes('a.id = ? and cl.id = ?')) return [{ ...row }];
      if (/FROM\s+participant\s+JOIN/.test(query)) return [{ person_id: 10, firstname: 'Jane', lastname: 'Doe', player_type_id: 1000 }];
      if (query.includes('SELECT id FROM person')) return [{ id: 10 }];
      if (query.includes('FROM activity_supported')) return [{ supported: 1 }];
      if (query.includes('AS booking_type_desc')) return [{ group_id: 1, same_day_only: 0 }];
      if (query.includes('AS schedule_id')) {
        scheduleStarts.push(values.start);
        const secs = time => { const [h, m] = time.split(':').map(Number); return hms(h, m); };
        return [{ utc_start: secs(values.start), utc_end: secs(values.end), utc_req_time: row.utc_req_time, schedule_id: 1 }];
      }
      if (query.includes('rt.requires_pass = 1')) return [];
      if (query.includes('r.type = ?')) return [];
      if (query.includes('FROM club_role_setting')) return [];
      if (query.startsWith('INSERT INTO `activity`')) return { insertId: 2 };
      if (query.includes('INSERT INTO participant')) return { affectedRows: 1 };
      if (query.includes('FOR UPDATE')) return [];
      throw new Error(`Unexpected SQL: ${query}`);
    };
  });
  afterEach(() => Object.assign(sql, original));

  it('ends a session at the start of the current minute', async () => {
    await processors.endSession(1, { hash });
    expect(executes).to.have.length(1);
    expect(executes[0].query).to.include('SET end_at = FROM_UNIXTIME(?)');
    expect(executes[0].values).to.deep.equal([hms(11, 37), 1]);
  });

  it('splits an ongoing court change on the same whole minute', async () => {
    await processors.changeCourt(1, { hash, court: 2 });
    expect(executes[0].query).to.include('SET end_at = FROM_UNIXTIME(?)');
    expect(executes[0].values).to.deep.equal([hms(11, 37), 1]);
    expect(scheduleStarts).to.deep.equal(['11:37:00']);
  });

  it('moves a session whole when it started within the current minute', async () => {
    Object.assign(row, { start: '11:37:00', utc_start: hms(11, 37) });
    await processors.changeCourt(1, { hash, court: 2 });
    expect(executes[0].query).to.include('SET active = 0');
    expect(scheduleStarts).to.deep.equal(['11:37:00']);
  });
});
