import { expect } from "chai";

import rules from "../../guest-pass-types/rules.js";

const { evaluatePassRules, earliestPlayAfter, timeToMinutes, formatClock } = rules;

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
