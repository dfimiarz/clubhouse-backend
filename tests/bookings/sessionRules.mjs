import { expect } from "chai";

import playerType from "../../bookings/playerType.js";
import sessionRules from "../../bookings/sessionRules.js";

const { PLAYER_TYPE_IDS } = playerType;
const { resolveSessionRules } = sessionRules;

const { NON_REPEATER, FIRST_REPEATER, SECOND_REPEATER } = PLAYER_TYPE_IDS;

/**
 * The 35-row frontend table keyed by hundreds=non-repeaters,
 * tens=first-repeaters, ones=second-repeaters.
 */
const LEGACY_RULES = [
  { id: 100, bumpable: false, maxduration: 45 * 60000 },
  { id: 10, bumpable: false, maxduration: 45 * 60000 },
  { id: 1, bumpable: true, maxduration: 45 * 60000 },
  { id: 200, bumpable: false, maxduration: 60 * 60000 },
  { id: 110, bumpable: false, maxduration: 30 * 60000 },
  { id: 20, bumpable: false, maxduration: 30 * 60000 },
  { id: 101, bumpable: true, maxduration: 30 * 60000 },
  { id: 11, bumpable: true, maxduration: 30 * 60000 },
  { id: 2, bumpable: true, maxduration: 30 * 60000 },
  { id: 300, bumpable: false, maxduration: 60 * 60000 },
  { id: 210, bumpable: false, maxduration: 60 * 60000 },
  { id: 120, bumpable: false, maxduration: 30 * 60000 },
  { id: 201, bumpable: true, maxduration: 30 * 60000 },
  { id: 30, bumpable: false, maxduration: 30 * 60000 },
  { id: 111, bumpable: true, maxduration: 30 * 60000 },
  { id: 21, bumpable: true, maxduration: 30 * 60000 },
  { id: 102, bumpable: true, maxduration: 30 * 60000 },
  { id: 12, bumpable: true, maxduration: 30 * 60000 },
  { id: 3, bumpable: true, maxduration: 30 * 60000 },
  { id: 400, bumpable: false, maxduration: 90 * 60000 },
  { id: 310, bumpable: false, maxduration: 45 * 60000 },
  { id: 220, bumpable: false, maxduration: 45 * 60000 },
  { id: 301, bumpable: true, maxduration: 45 * 60000 },
  { id: 130, bumpable: false, maxduration: 45 * 60000 },
  { id: 211, bumpable: true, maxduration: 45 * 60000 },
  { id: 40, bumpable: false, maxduration: 45 * 60000 },
  { id: 121, bumpable: true, maxduration: 45 * 60000 },
  { id: 202, bumpable: true, maxduration: 45 * 60000 },
  { id: 31, bumpable: true, maxduration: 45 * 60000 },
  { id: 112, bumpable: true, maxduration: 45 * 60000 },
  { id: 22, bumpable: true, maxduration: 45 * 60000 },
  { id: 103, bumpable: true, maxduration: 45 * 60000 },
  { id: 13, bumpable: true, maxduration: 45 * 60000 },
  { id: 4, bumpable: true, maxduration: 45 * 60000 },
];

function typesFromLegacyId(id) {
  const nonRepeaters = Math.floor(id / 100);
  const firstRepeaters = Math.floor((id % 100) / 10);
  const secondRepeaters = id % 10;
  return [
    ...Array(nonRepeaters).fill(NON_REPEATER),
    ...Array(firstRepeaters).fill(FIRST_REPEATER),
    ...Array(secondRepeaters).fill(SECOND_REPEATER),
  ];
}

describe("resolveSessionRules", () => {
  LEGACY_RULES.forEach((rule) => {
    const types = typesFromLegacyId(rule.id);
    const expectedMin = rule.maxduration / 60000;

    it(`matches legacy id ${rule.id} → ${expectedMin} min, bumpable=${rule.bumpable}`, () => {
      const result = resolveSessionRules(types);
      expect(result.bumpable).to.equal(rule.bumpable);
      expect(result.max_duration_min).to.equal(expectedMin);
      expect(result.player_count).to.equal(types.length);
    });
  });

  it("does not depend on player type order", () => {
    const a = resolveSessionRules([NON_REPEATER, FIRST_REPEATER, SECOND_REPEATER]);
    const b = resolveSessionRules([SECOND_REPEATER, NON_REPEATER, FIRST_REPEATER]);
    expect(a.max_duration_min).to.equal(b.max_duration_min);
    expect(a.bumpable).to.equal(b.bumpable);
    expect(a.player_count).to.equal(b.player_count);
  });

  it("rejects an empty lineup", () => {
    expect(() => resolveSessionRules([])).to.throw("Incorrect number of player types");
  });

  it("rejects more than 4 player types", () => {
    expect(() =>
      resolveSessionRules([
        NON_REPEATER,
        NON_REPEATER,
        NON_REPEATER,
        NON_REPEATER,
        NON_REPEATER,
      ])
    ).to.throw("Incorrect number of player types");
  });

  it("rejects a non-array", () => {
    expect(() => resolveSessionRules(null)).to.throw("Incorrect number of player types");
  });

  it("rejects an unknown player type", () => {
    expect(() => resolveSessionRules([4000])).to.throw("Unknown player type");
    expect(() => resolveSessionRules([NON_REPEATER, 999])).to.throw(
      "Unknown player type"
    );
  });
});
