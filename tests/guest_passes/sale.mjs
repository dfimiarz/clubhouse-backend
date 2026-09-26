import { expect } from 'chai';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import sql from '../../db/SqlConnector.js';
import redis from '../../db/RedisConnector.js';
import controller from '../../guest_passes/controller.js';
import passTypes from '../../guest-pass-types/controller.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const time_zone = 'America/New_York';
// ISO weekday and minute of the club-local sale time, so tests hold on any day.
const now = dayjs().tz(time_zone);
const today = now.day() || 7;
const nowMin = now.hour() * 60 + now.minute();
// Open all day, every day, unless a test narrows it.
const allDay = [1, 2, 3, 4, 5, 6, 7].map(dayofweek => ({ from: '2000-01-01', to: '2099-12-31', dayofweek, open_min: 0, close_min: 1440 }));

describe('guest pass sale', () => {
  const original = { withConnection: sql.withConnection, runExecute: sql.runExecute, runQuery: sql.runQuery };
  const originalDelete = redis.deleteKey;
  let passType, settings, inserts, hours, season, hoursQueries, roleChecks;

  beforeEach(() => {
    passType = { label: 'Weekday pass', valid_days: 1, season_limit: 0 };
    settings = []; inserts = []; hours = allDay; hoursQueries = []; roleChecks = [];
    // Club-local DATE strings, as the pool returns them (dateStrings: true).
    season = { time_zone, season_start: '2000-01-01', season_end: '2100-01-01' };
    redis.deleteKey = async () => {};
    const connection = { async beginTransaction() {}, async commit() {}, async rollback() {} };
    sql.withConnection = async work => work(connection);
    sql.runExecute = async (_conn, query, values) => {
      if (query.includes('from club c join club_seasons')) return season ? [season] : [];
      if (query.includes('court_schedule_item')) {
        hoursQueries.push(query);
        if (hours instanceof Error) throw hours;
        return hours;
      }
      if (query.includes('FROM membership_view')) {
        roleChecks.push(values);
        const [host, guest] = values;
        return [
          { id: host, guest_host: 1, requires_pass: 0 },
          { id: guest, guest_host: 0, requires_pass: 1 },
        ];
      }
      if (query.includes('FROM guest_pass_type WHERE')) return [passType];
      if (query.includes('ORDER BY label')) return [{ id: 3, ...passType }];
      if (query.includes('FROM clubhouse.guest_pass')) return [];
      if (query.startsWith('INSERT INTO `guest_pass`')) { inserts.push(values); return { insertId: 41 }; }
      throw new Error(`Unexpected SQL: ${query}`);
    };
    sql.runQuery = async () => settings.map(([setting_key, setting_value]) => ({ pass_type: 3, setting_key, setting_value }));
  });
  afterEach(() => { Object.assign(sql, original); redis.deleteKey = originalDelete; });

  const sell = () => controller.addGuestPass({ guest: 11, host: 12, pass_type: 3 });

  it('refuses a pass with no allowed day before it expires', async () => {
    settings = [['allowed_days', JSON.stringify([today % 7 + 1])]];
    const error = await sell().then(() => null, err => err);
    expect(error).to.include({ status: 400 });
    expect(error.message).to.match(/^Weekday pass cannot be used before it expires\. Play on \w+ only\.$/);
    expect(inserts).to.have.length(0);
  });

  it('sells when a later day in the window is allowed', async () => {
    passType.valid_days = 2;
    settings = [['allowed_days', JSON.stringify([today % 7 + 1])]];
    const pass = await sell();
    expect(pass).to.include({ id: 41, type: 3 });
    expect(inserts).to.have.length(1);
  });

  it('checks the host and guest roles in one query', async () => {
    await sell();
    expect(roleChecks.map((values) => values.slice(0, 2))).to.deep.equal([[12, 11]]);
  });

  it('refuses a host who cannot host guests', async () => {
    sql.runExecute = ((inner) => async (conn, query, values) => (
      query.includes('FROM membership_view')
        ? [{ id: 12, guest_host: 0, requires_pass: 0 }, { id: 11, guest_host: 0, requires_pass: 1 }]
        : inner(conn, query, values)
    ))(sql.runExecute);
    const error = await sell().then(() => null, err => err);
    expect(error).to.include({ status: 400, message: 'Invalid guest host' });
    expect(inserts).to.have.length(0);
  });

  it('sells a play_after pass before its cutoff while courts stay open past it', async function () {
    if (nowMin > 1440 - 60) this.skip();
    const cutoff = now.add(30, 'minute').format('HH:mm');
    settings = [['play_after', cutoff], ['allowed_days', JSON.stringify([today])]];
    const pass = await sell();
    expect(pass.constraints.map(c => c.key)).to.have.members(['play_after', 'allowed_days']);
    expect(inserts).to.have.length(1);
  });

  it('refuses a one-day pass once courts have closed for the day', async () => {
    passType.label = 'Day pass';
    // Today's courts closed at the current minute; MySQL DAYOFWEEK has Sunday = 1.
    hours = allDay.map(row => (row.dayofweek === today % 7 + 1 ? { ...row, close_min: nowMin } : row));
    const error = await sell().then(() => null, err => err);
    expect(error.message).to.equal('Day pass cannot be used before it expires. No open court time is left.');
    expect(inserts).to.have.length(0);

    passType.valid_days = 2;
    await sell();
    expect(inserts).to.have.length(1);
  });

  it('marks catalog types that cannot be sold today with the same reason', async () => {
    settings = [['allowed_days', JSON.stringify([today % 7 + 1])]];
    const [unsellable] = await passTypes.getPassTypes();
    expect(unsellable).to.include({
      sellable: false,
      unavailable_reason: (await sell().catch(err => err)).message,
    });

    passType.valid_days = 2;
    const [sellable] = await passTypes.getPassTypes();
    expect(sellable).to.include({ sellable: true, unavailable_reason: null });
  });

  it('reads open hours under a share lock during a sale but not for the catalog', async () => {
    await sell();
    expect(hoursQueries.pop()).to.match(/FOR SHARE\s*$/);
    await passTypes.getPassTypes();
    expect(hoursQueries.pop()).to.not.include('FOR SHARE');
  });

  it('ends a pass at the last club-local second of the season', async () => {
    passType.valid_days = 7;
    const tomorrow = now.add(1, 'day').format('YYYY-MM-DD');
    season.season_end = tomorrow;
    await sell();
    expect(inserts[0].slice(3)).to.deep.equal([
      `${now.format('YYYY-MM-DD')} 00:00:00`,
      `${now.format('YYYY-MM-DD')} 23:59:59`,
    ]);
  });

  it('leaves room for a minimum session before closing', async function () {
    const current = dayjs().tz(time_zone);
    const minute = current.hour() * 60 + current.minute();
    if (minute > 1440 - 10) this.skip();
    const dayofweek = (current.day() || 7) % 7 + 1;
    const closeToday = close => allDay.map(row => (row.dayofweek === dayofweek ? { ...row, close_min: close } : row));
    passType.label = 'Day pass';
    // 4 minutes left is too short even if the clock ticks over mid-test.
    hours = closeToday(minute + 4);
    expect((await sell().catch(err => err)).message).to.equal('Day pass cannot be used before it expires. No open court time is left.');
    // One spare minute on top of the 5-minute minimum for the same reason.
    hours = closeToday(minute + 6);
    await sell();
    expect(inserts).to.have.length(1);
  });

  it('gives the same out-of-season reason in the catalog and on sale', async () => {
    season = null;
    const error = await sell().catch(err => err);
    expect(error).to.include({ status: 400 });
    const [entry] = await passTypes.getPassTypes();
    expect(entry).to.include({ sellable: false, unavailable_reason: error.message });
  });

  it('gives the same misconfiguration reason in the catalog and on sale', async () => {
    passType.valid_days = 0;
    const error = await sell().catch(err => err);
    const [entry] = await passTypes.getPassTypes();
    expect(entry).to.include({ sellable: false, unavailable_reason: error.message });
  });

  it('still lists pass types without availability when it cannot be evaluated', async () => {
    hours = new Error('Open hours unavailable');
    const [entry] = await passTypes.getPassTypes();
    expect(entry).to.include({ id: 3, label: 'Weekday pass' });
    expect(entry).to.not.have.any.keys('sellable', 'unavailable_reason');
  });
});
