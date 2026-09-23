import { expect } from 'chai';
import sql from '../../db/SqlConnector.js';
import hours from '../../club_schedule/hours.js';

const { loadOpenHours, openFramesOn } = hours;

describe('club open hours', () => {
  const rows = [
    { from: '2026-09-01', to: '2026-09-30', dayofweek: 1, open_min: 480, close_min: 1200 },
    { from: '2026-09-01', to: '2026-09-30', dayofweek: 2, open_min: 360, close_min: 1320 },
    { from: '2026-10-01', to: '2026-10-31', dayofweek: 2, open_min: 540, close_min: 1080 },
  ];

  it('matches MySQL DAYOFWEEK, where Sunday is 1', () => {
    expect(openFramesOn(rows, '2026-09-13')).to.deep.equal([rows[0]]); // Sunday
    expect(openFramesOn(rows, '2026-09-14')).to.deep.equal([rows[1]]); // Monday
    expect(openFramesOn(rows, '2026-09-15')).to.deep.equal([]);
  });

  it('matches nothing for an unreadable date', () => {
    for (const date of [undefined, 'invalid', '2026-02-30']) {
      expect(openFramesOn(rows, date)).to.deep.equal([]);
    }
  });

  it('uses the schedule covering the date, with an inclusive end', () => {
    expect(openFramesOn(rows, '2026-09-28')).to.deep.equal([rows[1]]);
    expect(openFramesOn(rows, '2026-10-05')).to.deep.equal([rows[2]]);
    expect(openFramesOn(rows, '2026-11-02')).to.deep.equal([]);
  });

  it('reads overlapping schedules as numbers', async () => {
    const original = sql.runExecute;
    let args;
    sql.runExecute = async (_conn, _query, values) => {
      args = values;
      return [{ from: '2026-09-01', to: '2026-09-30', dayofweek: '2', open_min: '360', close_min: '1320' }];
    };
    try {
      expect(await loadOpenHours({}, 1, '2026-09-14', '2026-09-20')).to.deep.equal([rows[1]]);
      expect(args).to.deep.equal([1, '2026-09-14', '2026-09-20']);
    } finally {
      sql.runExecute = original;
    }
  });
});
