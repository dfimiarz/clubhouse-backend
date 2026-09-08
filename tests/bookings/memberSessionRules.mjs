import { expect } from "chai";
import { memberSessionRuleError } from "../../bookings/sessionRules.js";

function booking(overrides = {}) {
  return {
    group_id: 1, utc_start: 0, utc_end: 30 * 60, bumpable: 1, notes: null,
    players: [{ player_type_id: 1000 }, { player_type_id: 3000 }],
    ...overrides,
  };
}

describe("member session creation rules", () => {
  it("accepts the preferred duration and bumpable flag without a note", () => {
    expect(memberSessionRuleError(booking())).to.equal(null);
  });

  it("requires an explanation for either duration or bumpable overrides", () => {
    for (const override of [{ utc_end: 60 * 60 }, { bumpable: 0 }]) {
      for (const notes of [null, "", "   "]) {
        expect(memberSessionRuleError(booking({ ...override, notes }))).to.equal("Explain the session rule override in the note");
      }
      expect(memberSessionRuleError(booking({ ...override, notes: "Approved extra time" }))).to.equal(null);
    }
  });

  it("uses the configured bumpability policy", () => {
    expect(memberSessionRuleError(booking({ bumpable: 0 }), undefined, "never")).to.equal(null);
    expect(memberSessionRuleError(booking({
      bumpable: 0,
      players: [{ player_type_id: 1000 }, { player_type_id: 1000 }],
    }), undefined, "always")).to.equal("Explain the session rule override in the note");
  });

  it("enforces the absolute maximum even when explained", () => {
    expect(memberSessionRuleError(booking({ utc_end: 181 * 60, notes: "Approved" }))).to.equal("Member sessions must be between 5 and 180 minutes long");
    expect(memberSessionRuleError(booking({ utc_end: 180 * 60, notes: "Approved" }))).to.equal(null);
  });

  it("rejects event-host types on member bookings", () => {
    expect(memberSessionRuleError(booking({ players: [{ player_type_id: 4000 }] }))).to.equal("Invalid player type for a member booking");
  });

  it("leaves event duration and host rules to the event flow", () => {
    expect(memberSessionRuleError(booking({ group_id: 2, utc_end: 240 * 60, players: [{ player_type_id: 4000 }] }))).to.equal(null);
  });
});
