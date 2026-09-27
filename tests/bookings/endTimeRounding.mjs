import { expect } from 'chai';
import sql from '../../db/SqlConnector.js';
import processors from '../../bookings/processor.js';

const hms = (h, m, s = 0) => h * 3600 + m * 60 + s;

describe('early end times round down to the minute', () => {
  const original = { withConnection: sql.withConnection, runQuery: sql.runQuery, runExecute: sql.runExecute };
  const hash = 'a'.repeat(32);
  let row, executes, scheduleStarts, scheduleDates, overlapResults, savepoints, inserts, restriction, activityTypes, typeReads;

  beforeEach(() => {
    executes = []; scheduleStarts = []; scheduleDates = []; overlapResults = []; savepoints = []; inserts = []; restriction = null; typeReads = 0;
    activityTypes = [{ group_id: 1, same_day_only: 0 }];
    row = {
      id: 1, active: 1, etag: hash, court_id: 1, club_id: process.env.CLUB_ID,
      date: '2026-09-14', start: '10:00:00', end: '12:00:00', type: 1000, group_id: 1,
      utc_start: hms(10, 0), utc_end: hms(12, 0), utc_created: hms(9, 0),
      utc_req_time: hms(11, 37, 22), loc_req_time: '11:37:22', loc_req_date: 20260914,
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
      if (query.includes('AS booking_type_desc')) { typeReads++; return activityTypes; }
      if (query.includes('AS schedule_id')) {
        scheduleStarts.push(values.start);
        scheduleDates.push(values.date);
        const secs = time => { const [h, m] = time.split(':').map(Number); return hms(h, m); };
        return [{ utc_start: secs(values.start), utc_end: secs(values.end), utc_req_time: row.utc_req_time, schedule_id: 1 }];
      }
      if (query.includes('rt.requires_pass = 1')) return [];
      if (query.includes('r.type = ?')) return restriction
        ? [{ id: 10, firstname: 'Jane', lastname: 'Doe', role_id: 1500, role_label: 'Junior' }] : [];
      if (query.includes('FROM club_role_setting')) return Object.entries(restriction ?? {}).map(([setting_key, value]) => ({
        role: 1500, setting_key, setting_value: Array.isArray(value) ? JSON.stringify(value) : value,
      }));
      if (query.includes('SAVEPOINT')) { savepoints.push(query); return {}; }
      if (query.startsWith('INSERT INTO `activity`')) { inserts.push(values); return { insertId: 2 }; }
      if (query.includes('INSERT INTO participant')) return { affectedRows: 1 };
      if (query.includes('AND court = ?')) return overlapResults.shift() ?? [];
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

  it('ends a session on the grid minute a Fast rebook starts from', async () => {
    // Fast rebook asks for the ended session's end rounded up to 5 minutes.
    // Ended at 11:40:22, that is 11:40:00, and the court overlap check
    // (end_at > new start) only lets it through if the end is not later.
    row.utc_req_time = hms(11, 40, 22);
    await processors.endSession(1, { hash });
    const [endAt] = executes[0].values;
    expect(endAt).to.equal(hms(11, 40));
    expect(endAt > hms(11, 40)).to.equal(false);
  });

  it('splits an ongoing court change on the same whole minute', async () => {
    await processors.changeCourt(1, { hash, court: 2 });
    expect(executes[0].query).to.include('SET end_at = FROM_UNIXTIME(?)');
    expect(executes[0].values).to.deep.equal([hms(11, 37), 1]);
    expect(scheduleStarts).to.deep.equal(['11:37:00']);
    expect(scheduleDates).to.deep.equal(['2026-09-14']);
  });

  it('puts the moved half on today when the split happens after midnight', async () => {
    const day = 24 * 3600;
    Object.assign(row, {
      start: '23:00:00', end: '00:30:00',
      utc_start: hms(23, 0), utc_end: day + hms(0, 30),
      utc_req_time: day + hms(0, 5, 41), loc_req_time: '00:05:41', loc_req_date: 20260915,
    });
    const dates = await processors.changeCourt(1, { hash, court: 2 });
    expect(executes[0].values).to.deep.equal([day + hms(0, 5), 1]);
    expect(scheduleStarts).to.deep.equal(['00:05:00']);
    expect(scheduleDates).to.deep.equal(['2026-09-15']);
    expect(dates).to.deep.equal(['2026-09-14', '2026-09-15']);
  });

  it('reports one date for a court change within a day', async () => {
    expect(await processors.changeCourt(1, { hash, court: 2 })).to.deep.equal(['2026-09-14']);
  });

  it('leaves a request time without seconds as is', async () => {
    Object.assign(row, { utc_req_time: hms(11, 37), loc_req_time: '11:37' });
    await processors.changeCourt(1, { hash, court: 2 });
    expect(scheduleStarts).to.deep.equal(['11:37']);
  });

  it('moves a session whole when it started within the current minute', async () => {
    Object.assign(row, { start: '11:37:00', utc_start: hms(11, 37) });
    await processors.changeCourt(1, { hash, court: 2 });
    expect(executes[0].query).to.include('SET active = 0');
    expect(scheduleStarts).to.deep.equal(['11:37:00']);
  });

  it('splits a court change with less than 5 minutes left', async () => {
    Object.assign(row, { end: '11:39:00', utc_end: hms(11, 39) });
    await processors.changeCourt(1, { hash, court: 2 });
    expect(executes[0].query).to.include('SET end_at = FROM_UNIXTIME(?)');
    expect(executes[0].values).to.deep.equal([hms(11, 37), 1]);
    expect(scheduleStarts).to.deep.equal(['11:37:00']);
  });

  it('moves a session whole when it started less than 5 minutes ago', async () => {
    Object.assign(row, { start: '11:34:00', utc_start: hms(11, 34) });
    await processors.changeCourt(1, { hash, court: 2 });
    expect(executes[0].query).to.include('SET active = 0');
    expect(scheduleStarts).to.deep.equal(['11:34:00']);
  });

  it('splits a fresh session when the new court was busy since its start', async () => {
    Object.assign(row, { start: '11:34:00', utc_start: hms(11, 34) });
    overlapResults = [[{ id: 7 }]];
    await processors.changeCourt(1, { hash, court: 2 });
    expect(executes[0].query).to.include('SET end_at = FROM_UNIXTIME(?)');
    expect(executes[0].values).to.deep.equal([hms(11, 37), 1]);
    expect(scheduleStarts).to.deep.equal(['11:34:00', '11:37:00']);
  });

  it('splits a fresh session when a roster check rejects the whole move', async () => {
    Object.assign(row, { start: '11:34:00', utc_start: hms(11, 34) });
    restriction = { play_after: '11:36' };
    await processors.changeCourt(1, { hash, court: 2 });
    expect(savepoints).to.deep.equal(['SAVEPOINT court_change_whole', 'ROLLBACK TO SAVEPOINT court_change_whole']);
    expect(executes.map(e => e.query)).to.satisfy(([whole, split]) =>
      whole.includes('SET active = 0') && split.includes('SET end_at = FROM_UNIXTIME(?)'));
    expect(executes[1].values).to.deep.equal([hms(11, 37), 1]);
    expect(scheduleStarts).to.deep.equal(['11:34:00', '11:37:00']);
    expect(inserts).to.have.length(1);
    expect(inserts[0][3]).to.equal(hms(11, 37));
    expect(typeReads).to.equal(1);
  });

  it('keeps the original creation time when a started session moves whole', async () => {
    Object.assign(row, { start: '11:34:00', utc_start: hms(11, 34) });
    await processors.changeCourt(1, { hash, court: 2 });
    expect(inserts[0][3]).to.equal(hms(11, 34));
    expect(inserts[0][8]).to.equal(hms(9, 0));
  });

  it('gives a split its own creation time', async () => {
    await processors.changeCourt(1, { hash, court: 2 });
    expect(inserts[0][8]).to.equal(null);
  });

  it('rejects a time change with a 422 when the activity type is no longer enabled', async () => {
    activityTypes = [];
    let error;
    try { await processors.changeSessionTime(1, { hash, start: '11:00', end: '12:00' }); } catch (e) { error = e; }
    expect(error?.status).to.equal(422);
    expect(error?.payload).to.equal('Unable to create the moved booking');
    expect(inserts).to.have.length(0);
  });

  it('rejects a court change with a 422 when the activity type is no longer enabled', async () => {
    activityTypes = [];
    let error;
    try { await processors.changeCourt(1, { hash, court: 2 }); } catch (e) { error = e; }
    expect(error?.status).to.equal(422);
    expect(error?.payload).to.equal('Unable to create the moved booking');
    expect(executes).to.have.length(0);
  });

  it('rejects a court change when the new court is busy for the rest of the session', async () => {
    overlapResults = [[{ id: 7 }]];
    let error;
    try { await processors.changeCourt(1, { hash, court: 2 }); } catch (e) { error = e; }
    expect(error?.payload).to.equal('Booking overlap found. Pick a different court.');
    expect(executes).to.have.length(0);
  });
});
