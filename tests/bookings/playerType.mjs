import { expect } from "chai";

import playerType from "../../bookings/playerType.js";

const {
  PLAYER_TYPE_IDS,
  MEMBER_ACTIVITY_GROUP_ID,
  playerTypeFromFactor,
  playerSessionsFromBookings,
  sessionRepeaterValue,
  computeRepeaterFactor,
  suggestPlayerTypes,
} = playerType;

function booking({
  personIds,
  startMin = 600,
  endMin = 660,
  groupId = MEMBER_ACTIVITY_GROUP_ID,
}) {
  return {
    start_min: startMin,
    end_min: endMin,
    group_id: groupId,
    players: personIds.map((person_id) => ({ person_id })),
  };
}

describe("playerTypeFromFactor", () => {
  it("returns null for non-finite values", () => {
    expect(playerTypeFromFactor(null)).to.equal(null);
    expect(playerTypeFromFactor(undefined)).to.equal(null);
    expect(playerTypeFromFactor(Number.NaN)).to.equal(null);
    expect(playerTypeFromFactor(Infinity)).to.equal(null);
    expect(playerTypeFromFactor("")).to.equal(null);
  });

  it("classifies non-repeaters below 1", () => {
    expect(playerTypeFromFactor(0)).to.equal(PLAYER_TYPE_IDS.NON_REPEATER);
    expect(playerTypeFromFactor(0.999)).to.equal(PLAYER_TYPE_IDS.NON_REPEATER);
  });

  it("classifies first repeaters from 1 inclusive up to 1.5 exclusive", () => {
    expect(playerTypeFromFactor(1)).to.equal(PLAYER_TYPE_IDS.FIRST_REPEATER);
    expect(playerTypeFromFactor(1.499)).to.equal(PLAYER_TYPE_IDS.FIRST_REPEATER);
  });

  it("classifies second repeaters from 1.5 inclusive", () => {
    expect(playerTypeFromFactor(1.5)).to.equal(PLAYER_TYPE_IDS.SECOND_REPEATER);
    expect(playerTypeFromFactor(2)).to.equal(PLAYER_TYPE_IDS.SECOND_REPEATER);
  });
});

describe("playerSessionsFromBookings", () => {
  it("keeps only bookings the person is on, with duration and roster size", () => {
    const bookings = [
      booking({ personIds: [1, 2], startMin: 600, endMin: 660 }),
      booking({ personIds: [3], startMin: 700, endMin: 730 }),
      booking({ personIds: [2], startMin: 800, endMin: 845 }),
    ];

    expect(playerSessionsFromBookings(2, bookings)).to.deep.equal([
      { durationMin: 60, playerCount: 2 },
      { durationMin: 45, playerCount: 1 },
    ]);
  });

  it("matches string person ids from the API", () => {
    const bookings = [booking({ personIds: ["7"], startMin: 0, endMin: 30 })];
    expect(playerSessionsFromBookings(7, bookings)).to.deep.equal([
      { durationMin: 30, playerCount: 1 },
    ]);
  });

  it("skips bookings with a missing or non-positive duration", () => {
    const bookings = [
      { start_min: 600, end_min: 600, group_id: MEMBER_ACTIVITY_GROUP_ID, players: [{ person_id: 1 }] },
      { start_min: 700, group_id: MEMBER_ACTIVITY_GROUP_ID, players: [{ person_id: 1 }] },
      booking({ personIds: [1], startMin: 800, endMin: 820 }),
    ];

    expect(playerSessionsFromBookings(1, bookings)).to.deep.equal([
      { durationMin: 20, playerCount: 1 },
    ]);
  });

  it("skips club, support, and rosters outside 1–4", () => {
    const bookings = [
      booking({ personIds: [1], startMin: 600, endMin: 660, groupId: 2 }),
      booking({ personIds: [1], startMin: 700, endMin: 760, groupId: 3 }),
      booking({ personIds: [1, 2, 3, 4, 5], startMin: 800, endMin: 860 }),
      booking({ personIds: [1], startMin: 900, endMin: 945 }),
    ];

    expect(playerSessionsFromBookings(1, bookings)).to.deep.equal([
      { durationMin: 45, playerCount: 1 },
    ]);
  });

  it("counts member-group sessions regardless of calendar_style", () => {
    const bookings = [
      { ...booking({ personIds: [1], startMin: 600, endMin: 645 }), calendar_style: "event" },
      {
        ...booking({ personIds: [1], startMin: 700, endMin: 745, groupId: 2 }),
        calendar_style: "match",
      },
    ];

    expect(playerSessionsFromBookings(1, bookings)).to.deep.equal([
      { durationMin: 45, playerCount: 1 },
    ]);
  });

  it("returns an empty list when the person or bookings are unusable", () => {
    expect(playerSessionsFromBookings("x", [booking({ personIds: [1] })])).to.deep.equal([]);
    expect(playerSessionsFromBookings(1, null)).to.deep.equal([]);
    expect(playerSessionsFromBookings(1, [])).to.deep.equal([]);
  });
});

describe("sessionRepeaterValue", () => {
  it("uses duration / (45 * player-count polynomial)", () => {
    // r(1)=1, r(2)=4/3, r(4)=2
    expect(sessionRepeaterValue({ durationMin: 45, playerCount: 1 })).to.equal(1);
    expect(sessionRepeaterValue({ durationMin: 45, playerCount: 2 })).to.equal(0.75);
    expect(sessionRepeaterValue({ durationMin: 45, playerCount: 4 })).to.equal(0.5);
    expect(sessionRepeaterValue({ durationMin: 20, playerCount: 1 })).to.equal(20 / 45);
  });

  it("returns null for unusable sessions", () => {
    expect(sessionRepeaterValue({ durationMin: 0, playerCount: 1 })).to.equal(null);
    expect(sessionRepeaterValue({ durationMin: 40, playerCount: 0 })).to.equal(null);
    expect(sessionRepeaterValue({ durationMin: 45, playerCount: 5 })).to.equal(null);
    expect(sessionRepeaterValue({ durationMin: 45, playerCount: 6 })).to.equal(null);
    expect(sessionRepeaterValue(null)).to.equal(null);
  });
});

describe("computeRepeaterFactor", () => {
  it("returns 0 when there are no sessions", () => {
    expect(computeRepeaterFactor([])).to.equal(0);
    expect(computeRepeaterFactor(null)).to.equal(0);
  });

  it("sums each session's value", () => {
    expect(
      computeRepeaterFactor([
        { durationMin: 20, playerCount: 1 },
        { durationMin: 40, playerCount: 2 },
      ])
    ).to.equal(20 / 45 + 40 / (45 * (4 / 3)));
  });

  it("skips invalid sessions in the sum", () => {
    expect(
      computeRepeaterFactor([
        { durationMin: 20, playerCount: 1 },
        { durationMin: 0, playerCount: 2 },
      ])
    ).to.equal(20 / 45);
  });
});

describe("suggestPlayerTypes", () => {
  it("classifies from today's sessions", () => {
    const bookings = [
      booking({ personIds: [2], startMin: 600, endMin: 640 }),
    ];
    expect(suggestPlayerTypes([1, 2], bookings, new Set([1, 2]))).to.deep.equal([
      {
        person_id: 1,
        factor: 0,
        player_type_id: PLAYER_TYPE_IDS.NON_REPEATER,
        sessions: [],
      },
      {
        person_id: 2,
        factor: 40 / 45,
        player_type_id: PLAYER_TYPE_IDS.NON_REPEATER,
        sessions: [{ durationMin: 40, playerCount: 1, value: 40 / 45 }],
      },
    ]);
  });

  it("preserves request order and returns null for ids not in the club", () => {
    expect(suggestPlayerTypes([9, 8], [], new Set([8]))).to.deep.equal([
      {
        person_id: 9,
        factor: null,
        player_type_id: null,
        sessions: [],
      },
      {
        person_id: 8,
        factor: 0,
        player_type_id: PLAYER_TYPE_IDS.NON_REPEATER,
        sessions: [],
      },
    ]);
  });

  it("does not classify an unknown id even if they appear on a booking", () => {
    const bookings = [
      booking({ personIds: [9], startMin: 600, endMin: 690 }),
    ];
    expect(suggestPlayerTypes([9], bookings, new Set())).to.deep.equal([
      {
        person_id: 9,
        factor: null,
        player_type_id: null,
        sessions: [],
      },
    ]);
  });
});
