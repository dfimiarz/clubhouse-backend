import { expect } from "chai";

import playerType from "../../bookings/playerType.js";

const {
  PLAYER_TYPE_IDS,
  MEMBER_ACTIVITY_GROUP_ID,
  playerTypeFromSessionCount,
  originIdFromBooking,
  playerSessionOriginsFromBookings,
  suggestPlayerTypes,
} = playerType;

function booking({
  personIds,
  id,
  originActivityId,
  groupId = MEMBER_ACTIVITY_GROUP_ID,
}) {
  return {
    id,
    origin_activity_id: originActivityId === undefined ? id : originActivityId,
    group_id: groupId,
    players: personIds.map((person_id) => ({ person_id })),
  };
}

describe("playerTypeFromSessionCount", () => {
  it("returns null for non-finite or negative values", () => {
    expect(playerTypeFromSessionCount(null)).to.equal(null);
    expect(playerTypeFromSessionCount(undefined)).to.equal(null);
    expect(playerTypeFromSessionCount(Number.NaN)).to.equal(null);
    expect(playerTypeFromSessionCount(Infinity)).to.equal(null);
    expect(playerTypeFromSessionCount("")).to.equal(null);
    expect(playerTypeFromSessionCount(-1)).to.equal(null);
  });

  it("classifies non-repeaters at 0 sessions", () => {
    expect(playerTypeFromSessionCount(0)).to.equal(PLAYER_TYPE_IDS.NON_REPEATER);
  });

  it("classifies first repeaters at 1 session", () => {
    expect(playerTypeFromSessionCount(1)).to.equal(PLAYER_TYPE_IDS.FIRST_REPEATER);
  });

  it("classifies second repeaters at 2 or more sessions", () => {
    expect(playerTypeFromSessionCount(2)).to.equal(PLAYER_TYPE_IDS.SECOND_REPEATER);
    expect(playerTypeFromSessionCount(3)).to.equal(PLAYER_TYPE_IDS.SECOND_REPEATER);
  });
});

describe("originIdFromBooking", () => {
  it("prefers origin_activity_id over the row id", () => {
    expect(originIdFromBooking({ id: 20, origin_activity_id: 10 })).to.equal(10);
  });

  it("falls back to the row id when origin is missing", () => {
    expect(originIdFromBooking({ id: 20 })).to.equal(20);
    expect(originIdFromBooking({ id: 20, origin_activity_id: null })).to.equal(20);
  });

  it("returns null when neither id is usable", () => {
    expect(originIdFromBooking({})).to.equal(null);
    expect(originIdFromBooking({ id: 0, origin_activity_id: -1 })).to.equal(null);
  });
});

describe("playerSessionOriginsFromBookings", () => {
  it("keeps distinct origins for bookings the person is on", () => {
    const bookings = [
      booking({ id: 1, personIds: [1, 2] }),
      booking({ id: 2, personIds: [3] }),
      booking({ id: 3, personIds: [2] }),
    ];

    expect(playerSessionOriginsFromBookings(2, bookings)).to.deep.equal([1, 3]);
  });

  it("counts court-move rows that share an origin as one session", () => {
    const bookings = [
      booking({ id: 10, originActivityId: 10, personIds: [1] }),
      booking({ id: 11, originActivityId: 10, personIds: [1] }),
    ];

    expect(playerSessionOriginsFromBookings(1, bookings)).to.deep.equal([10]);
  });

  it("falls back to the row id when origin is null", () => {
    const bookings = [
      booking({ id: 7, originActivityId: null, personIds: ["7"] }),
    ];
    expect(playerSessionOriginsFromBookings(7, bookings)).to.deep.equal([7]);
  });

  it("skips club and support groups", () => {
    const bookings = [
      booking({ id: 1, personIds: [1], groupId: 2 }),
      booking({ id: 2, personIds: [1], groupId: 3 }),
      booking({ id: 3, personIds: [1] }),
    ];

    expect(playerSessionOriginsFromBookings(1, bookings)).to.deep.equal([3]);
  });

  it("counts member-group sessions regardless of calendar_style or roster size", () => {
    const bookings = [
      { ...booking({ id: 1, personIds: [1] }), calendar_style: "event" },
      booking({ id: 2, personIds: [1, 2, 3, 4, 5] }),
    ];

    expect(playerSessionOriginsFromBookings(1, bookings)).to.deep.equal([1, 2]);
  });

  it("returns an empty list when the person or bookings are unusable", () => {
    expect(playerSessionOriginsFromBookings("x", [booking({ id: 1, personIds: [1] })])).to.deep.equal([]);
    expect(playerSessionOriginsFromBookings(1, null)).to.deep.equal([]);
    expect(playerSessionOriginsFromBookings(1, [])).to.deep.equal([]);
  });
});

describe("suggestPlayerTypes", () => {
  it("classifies from today's distinct sessions", () => {
    const bookings = [
      booking({ id: 1, personIds: [2] }),
    ];
    expect(suggestPlayerTypes([1, 2], bookings, new Set([1, 2]))).to.deep.equal([
      {
        person_id: 1,
        session_count: 0,
        player_type_id: PLAYER_TYPE_IDS.NON_REPEATER,
        origins: [],
      },
      {
        person_id: 2,
        session_count: 1,
        player_type_id: PLAYER_TYPE_IDS.FIRST_REPEATER,
        origins: [1],
      },
    ]);
  });

  it("treats two origins as a second repeater and three the same", () => {
    const two = [
      booking({ id: 1, personIds: [4] }),
      booking({ id: 2, personIds: [4] }),
    ];
    const three = [...two, booking({ id: 3, personIds: [4] })];

    expect(suggestPlayerTypes([4], two, new Set([4]))[0]).to.include({
      session_count: 2,
      player_type_id: PLAYER_TYPE_IDS.SECOND_REPEATER,
    });
    expect(suggestPlayerTypes([4], three, new Set([4]))[0]).to.include({
      session_count: 3,
      player_type_id: PLAYER_TYPE_IDS.SECOND_REPEATER,
    });
  });

  it("does not double-count a court-move continuation", () => {
    const bookings = [
      booking({ id: 10, originActivityId: 10, personIds: [4] }),
      booking({ id: 11, originActivityId: 10, personIds: [4] }),
    ];
    expect(suggestPlayerTypes([4], bookings, new Set([4]))[0]).to.include({
      session_count: 1,
      player_type_id: PLAYER_TYPE_IDS.FIRST_REPEATER,
    });
  });

  it("preserves request order and returns null for ids not in the club", () => {
    expect(suggestPlayerTypes([9, 8], [], new Set([8]))).to.deep.equal([
      {
        person_id: 9,
        session_count: null,
        player_type_id: null,
        origins: [],
      },
      {
        person_id: 8,
        session_count: 0,
        player_type_id: PLAYER_TYPE_IDS.NON_REPEATER,
        origins: [],
      },
    ]);
  });

  it("does not classify an unknown id even if they appear on a booking", () => {
    const bookings = [
      booking({ id: 1, personIds: [9] }),
    ];
    expect(suggestPlayerTypes([9], bookings, new Set())).to.deep.equal([
      {
        person_id: 9,
        session_count: null,
        player_type_id: null,
        origins: [],
      },
    ]);
  });
});
