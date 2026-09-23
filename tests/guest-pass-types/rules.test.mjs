import { expect } from "chai";

import rules from "../../guest-pass-types/rules.js";

const { evaluatePassRules, earliestPlayAfter, timeToMinutes, formatClock, hasPlayableTime } = rules;

describe("evaluatePassRules", function () {
  it("treats non-array playing-day settings as unrestricted without throwing", function () {
    for (const allowed_days of [undefined, null, 'Monday', 1, true, {}]) {
      expect(evaluatePassRules({ allowed_days }, { date: '2026-09-07' })).to.deep.equal({ ok: true });
    }
  });
  it("checks each ISO weekday against the club-local booking date", function () {
    for (let day = 1; day <= 7; day++) {
      const date = `2026-09-${String(day + 6).padStart(2, '0')}`;
      expect(evaluatePassRules({ allowed_days: [day] }, { date }).ok).to.equal(true);
      expect(evaluatePassRules({ allowed_days: [day % 7 + 1] }, { date })).to.include({
        ok: false, key: 'allowed_days', day,
      });
    }
  });

  it("handles daylight-saving dates and rejects unreadable booking dates", function () {
    for (const date of ['2026-03-08', '2026-11-01']) {
      expect(evaluatePassRules({ allowed_days: [7] }, { date }).ok).to.equal(true);
    }
    for (const date of [undefined, '2026-02-30', '2026-09-13T23:00:00Z', 'invalid']) {
      expect(evaluatePassRules({ allowed_days: [7] }, { date }).ok).to.equal(false);
    }
  });

  it("requires both weekday and time rules on the same pass", function () {
    const settings = { allowed_days: [1], play_after: '12:00' };
    expect(evaluatePassRules(settings, { date: '2026-09-07', start: '12:00' }).ok).to.equal(true);
    expect(evaluatePassRules(settings, { date: '2026-09-07', start: '11:59' }).ok).to.equal(false);
    expect(evaluatePassRules(settings, { date: '2026-09-08', start: '12:00' }).ok).to.equal(false);
  });
  it("allows any start when play_after is unset", function () {
    expect(evaluatePassRules({ play_after: null }, { start: "09:00" })).to.deep.equal({
      ok: true,
    });
    expect(evaluatePassRules({}, { start: "09:00" })).to.deep.equal({ ok: true });
  });

  it("rejects a start before play_after", function () {
    expect(evaluatePassRules({ play_after: "12:00" }, { start: "11:59" })).to.deep.equal({
      ok: false,
      key: "play_after",
      clock: "12:00",
    });
  });

  it("allows a start equal to play_after", function () {
    expect(evaluatePassRules({ play_after: "12:00" }, { start: "12:00" }).ok).to.equal(
      true
    );
    expect(
      evaluatePassRules({ play_after: "12:00" }, { start: "12:00:00" }).ok
    ).to.equal(true);
  });

  it("allows a start after play_after", function () {
    expect(evaluatePassRules({ play_after: "12:00" }, { start: "12:01" }).ok).to.equal(
      true
    );
  });

  it("treats an unreadable play_after as unrestricted", function () {
    expect(evaluatePassRules({ play_after: "noon" }, { start: "09:00" }).ok).to.equal(
      true
    );
  });

  it("rejects when play_after is set but the start cannot be read", function () {
    expect(evaluatePassRules({ play_after: "12:00" }, { start: "soon" })).to.include({
      ok: false,
      key: "play_after",
    });
  });
});

describe("time helpers", function () {
  it("parses HH:mm and HH:mm:ss", function () {
    expect(timeToMinutes("9:00")).to.equal(9 * 60);
    expect(timeToMinutes("12:00:00")).to.equal(12 * 60);
    expect(formatClock(12 * 60)).to.equal("12:00");
  });

  it("picks the earliest play_after among settings", function () {
    expect(
      earliestPlayAfter([{ play_after: "14:00" }, { play_after: "12:00" }, {}])
    ).to.equal("12:00");
  });
});

describe("hasPlayableTime", function () {
  const weekdays = { allowed_days: [1, 2, 3, 4, 5] };
  // Courts open around the clock, so only weekdays matter.
  const allDay = () => [{ open_min: 0, close_min: 1440 }];
  const days = (settings, from, to) => hasPlayableTime(settings, { from, to, openFrames: allDay });

  it("treats unrestricted settings as usable", function () {
    for (const settings of [null, undefined, {}, { allowed_days: null }]) {
      expect(days(settings, '2026-09-12', '2026-09-12')).to.equal(true);
    }
  });

  it("rejects a weekday pass whose whole window falls on a weekend", function () {
    expect(days(weekdays, '2026-09-12', '2026-09-12')).to.equal(false);
    expect(days(weekdays, '2026-09-12', '2026-09-13')).to.equal(false);
  });

  it("accepts a window that reaches an allowed day", function () {
    expect(days(weekdays, '2026-09-12', '2026-09-18')).to.equal(true);
    expect(days(weekdays, '2026-09-13', '2026-09-14')).to.equal(true);
    expect(days({ allowed_days: [7] }, '2026-09-12', '2026-09-13')).to.equal(true);
  });

  it("finds an allowed day in a long window and stops at its end", function () {
    expect(days({ allowed_days: [5] }, '2026-09-12', '2026-12-31')).to.equal(true);
    expect(days({ allowed_days: [5] }, '2026-09-12', '2026-09-17')).to.equal(false);
  });

  it("steps across daylight-saving and month boundaries", function () {
    expect(days({ allowed_days: [1] }, '2026-10-31', '2026-11-02')).to.equal(true);
    expect(days({ allowed_days: [1] }, '2026-10-31', '2026-11-01')).to.equal(false);
  });

  it("rejects unreadable or reversed windows", function () {
    expect(days(weekdays, 'invalid', '2026-09-18')).to.equal(false);
    expect(days(weekdays, '2026-09-14', '2026-02-30')).to.equal(false);
    expect(days(weekdays, '2026-09-15', '2026-09-14')).to.equal(false);
  });

  describe("with open hours", function () {
    // Open 08:00-22:00 every day except closed on 2026-09-15.
    const openFrames = (date) => (date === '2026-09-15' ? [] : [{ open_min: 480, close_min: 1320 }]);
    const today = (settings, nowMin, to = '2026-09-14') =>
      hasPlayableTime(settings, { from: '2026-09-14', to, nowMin, openFrames });

    it("allows a play_after pass before and after its cutoff while courts stay open", function () {
      expect(today({ play_after: '12:00' }, 11 * 60 + 55)).to.equal(true);
      expect(today({ play_after: '12:00' }, 20 * 60)).to.equal(true);
    });

    it("rejects a one-day pass once courts have closed or play_after is past closing", function () {
      expect(today({}, 22 * 60)).to.equal(false);
      expect(today({ play_after: '22:00' }, 9 * 60)).to.equal(false);
      expect(today({}, 21 * 60 + 59)).to.equal(true);
    });

    it("carries over to a later open day in the window", function () {
      expect(today({}, 23 * 60, '2026-09-15')).to.equal(false);
      expect(today({}, 23 * 60, '2026-09-16')).to.equal(true);
      // Later days are not limited by today's clock.
      expect(today({ play_after: '21:00' }, 23 * 60, '2026-09-16')).to.equal(true);
    });

    it("requires the allowed day itself to have open time", function () {
      expect(today({ allowed_days: [2] }, 0, '2026-09-20')).to.equal(false);
      expect(today({ allowed_days: [2] }, 0, '2026-09-22')).to.equal(true);
    });

    it("scans past seven days when hours vary by date", function () {
      const lateOpen = (date) => (date >= '2026-10-01' ? [{ open_min: 480, close_min: 1320 }] : []);
      expect(hasPlayableTime({}, { from: '2026-09-14', to: '2026-10-01', openFrames: lateOpen })).to.equal(true);
    });

    it("requires a start by lastStartMin on the window's last day", function () {
      const lastDay = (settings, lastStartMin, to = '2026-09-14') =>
        hasPlayableTime(settings, { from: '2026-09-14', to, nowMin: 9 * 60, lastStartMin, openFrames });
      // Pass expires at 19:59:59; an 8 pm cutoff can never be met.
      expect(lastDay({ play_after: '20:00' }, 19 * 60 + 59)).to.equal(false);
      expect(lastDay({ play_after: '19:59' }, 19 * 60 + 59)).to.equal(true);
      // Expires before opening.
      expect(lastDay({}, 7 * 60)).to.equal(false);
      // Earlier days are not limited by the last day's cutoff.
      expect(lastDay({ play_after: '20:00' }, 0, '2026-09-16')).to.equal(true);
    });

    it("leaves room for a minimum session before closing", function () {
      const late = (nowMin) =>
        hasPlayableTime({}, { from: '2026-09-14', to: '2026-09-14', nowMin, minSessionMin: 5, openFrames });
      expect(late(21 * 60 + 55)).to.equal(true);
      expect(late(21 * 60 + 56)).to.equal(false);
    });

    it("treats a date without open frames as closed", function () {
      expect(hasPlayableTime({}, { from: '2026-09-14', to: '2026-09-20', openFrames: () => [] })).to.equal(false);
    });
  });
});
