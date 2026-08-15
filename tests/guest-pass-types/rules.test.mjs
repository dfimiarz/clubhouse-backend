import { expect } from "chai";

import rules from "../../guest-pass-types/rules.js";

const { evaluatePassRules, earliestPlayAfter, timeToMinutes, formatClock } = rules;

describe("evaluatePassRules", function () {
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
