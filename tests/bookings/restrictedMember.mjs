import assert from 'node:assert/strict';
import { expect } from 'chai';
import sql from '../../db/SqlConnector.js';
import { assertRestrictedMembersCanPlay } from '../../bookings/restrictedMember.js';

describe('restricted member booking rules', () => {
  const originalQuery = sql.runQuery;
  const booking = { date: '2026-09-14', start: '12:00', players: [{ person_id: 10, player_type_id: 1000 }] };
  let members, settings, queries;
  beforeEach(() => {
    members = [{ id: 10, firstname: 'Jane', lastname: 'Doe', role_id: 1500, role_label: 'Junior' }];
    settings = { 1500: { play_after: '12:00', allowed_days: [1, 3, 5] } };
    queries = [];
    sql.runQuery = async (_conn, query, values) => {
      queries.push({ query, values });
      expect(query).to.include('LOCK IN SHARE MODE');
      if (query.includes('FROM person p')) {
        expect(query).to.include('? >= m.valid_from AND ? < m.valid_until');
        expect(query).to.include('p.club = ? AND r.type = ?');
        expect(values[3]).to.equal(process.env.CLUB_ID);
        expect(values[4]).to.equal(200);
        return members;
      }
      expect(query).to.include('FROM club_role_setting');
      expect(values[0]).to.equal(process.env.CLUB_ID);
      return Object.entries(settings).flatMap(([role, rules]) => Object.entries(rules).map(([setting_key, value]) => ({
        role: Number(role), setting_key, setting_value: Array.isArray(value) ? JSON.stringify(value) : value,
      })));
    };
  });
  afterEach(() => { sql.runQuery = originalQuery; });

  it('allows the exact earliest start and later times on an allowed day', async () => {
    for (const start of ['12:00', '12:00:00', '13:00']) await assertRestrictedMembersCanPlay({}, { ...booking, start });
  });

  it('rejects early play with the person, role, and required time', async () => {
    await assert.rejects(assertRestrictedMembersCanPlay({}, { ...booking, start: '11:59' }), {
      status: 422, payload: "Jane Doe's Junior membership does not allow play before 12:00.",
    });
  });

  it('rejects disallowed days using the session date and ignores participant type', async () => {
    await assert.rejects(assertRestrictedMembersCanPlay({}, {
      ...booking, date: '2026-09-12', players: [{ person_id: 10, player_type_id: 4000 }],
    }), { status: 422, payload: "Jane Doe's Junior membership does not allow play on Saturday." });
    expect(queries[0].values.slice(0, 3)).to.deep.equal(['2026-09-12', '2026-09-12', [[10]]]);
  });

  it('applies different role rules to each member without combining them', async () => {
    members.push({ id: 11, firstname: 'John', lastname: 'Smith', role_id: 1000, role_label: 'Afternoon' });
    settings[1000] = { play_after: '14:00' };
    await assert.rejects(assertRestrictedMembersCanPlay({}, { ...booking, players: [{ person_id: 10 }, { person_id: 11 }] }), {
      status: 422, payload: "John Smith's Afternoon membership does not allow play before 14:00.",
    });
  });

  it('does not duplicate messages for overlapping rows of the same membership role', async () => {
    members.push(members[0]);
    await assert.rejects(assertRestrictedMembersCanPlay({}, { ...booking, start: '09:00' }), {
      payload: "Jane Doe's Junior membership does not allow play before 12:00.",
    });
  });

  it('leaves roles without overrides unrestricted', async () => {
    settings = {};
    await assertRestrictedMembersCanPlay({}, { ...booking, start: '09:00', date: '2026-09-13' });
  });

  it('does not load settings when there are no restricted members', async () => {
    members = [];
    await assertRestrictedMembersCanPlay({}, booking);
    expect(queries).to.have.length(1);
    queries = [];
    await assertRestrictedMembersCanPlay({}, { ...booking, players: [] });
    expect(queries).to.have.length(0);
  });

  it('fails closed when the settings cannot be read', async () => {
    sql.runQuery = async (_conn, query) => query.includes('FROM person p') ? members : null;
    await assert.rejects(assertRestrictedMembersCanPlay({}, booking), /Unable to read restricted member settings/);
  });
});
