import { expect } from "chai";

import playerOverlap from "../../bookings/playerOverlap.js";
import playerType from "../../bookings/playerType.js";
import { checkPlayerOverlap } from "../../bookings/BookingUtils.js";
import sqlconnector from "../../db/SqlConnector.js";

const {
  personIdsFromPlayers,
  shouldCheckPlayerOverlap,
  formatPlayerOverlapMessage,
} = playerOverlap;
const { MEMBER_ACTIVITY_GROUP_ID } = playerType;

describe("shouldCheckPlayerOverlap", () => {
  it("is off when the club flag is off", () => {
    expect(
      shouldCheckPlayerOverlap({
        settingEnabled: false,
        groupId: MEMBER_ACTIVITY_GROUP_ID,
        personIds: [1],
      })
    ).to.equal(false);
  });

  it("is off for club and support activity groups", () => {
    expect(
      shouldCheckPlayerOverlap({
        settingEnabled: true,
        groupId: 2,
        personIds: [1],
      })
    ).to.equal(false);
    expect(
      shouldCheckPlayerOverlap({
        settingEnabled: true,
        groupId: 3,
        personIds: [1],
      })
    ).to.equal(false);
  });

  it("is off with an empty roster", () => {
    expect(
      shouldCheckPlayerOverlap({
        settingEnabled: true,
        groupId: MEMBER_ACTIVITY_GROUP_ID,
        personIds: [],
      })
    ).to.equal(false);
  });

  it("is on for a member-group booking when the flag is set", () => {
    expect(
      shouldCheckPlayerOverlap({
        settingEnabled: true,
        groupId: MEMBER_ACTIVITY_GROUP_ID,
        personIds: [12],
      })
    ).to.equal(true);
  });

  it("does not treat a manager role as an exemption — role is not an input", () => {
    expect(
      shouldCheckPlayerOverlap({
        settingEnabled: true,
        groupId: MEMBER_ACTIVITY_GROUP_ID,
        personIds: [99],
      })
    ).to.equal(true);
  });
});

describe("personIdsFromPlayers", () => {
  it("collects unique positive person ids", () => {
    expect(
      personIdsFromPlayers([
        { person_id: 1 },
        { person_id: "1" },
        { person_id: 2 },
        { person_id: 0 },
        { person_id: null },
      ])
    ).to.deep.equal([1, 2]);
  });

  it("returns an empty list for missing players", () => {
    expect(personIdsFromPlayers(undefined)).to.deep.equal([]);
    expect(personIdsFromPlayers(null)).to.deep.equal([]);
  });
});

describe("checkPlayerOverlap SQL", () => {
  const originalRunQuery = sqlconnector.runQuery;

  afterEach(() => {
    sqlconnector.runQuery = originalRunQuery;
  });

  it("looks back from min(start, now) and treats overnight still-open as a conflict", async () => {
    let query;
    let values;
    sqlconnector.runQuery = async (_connection, q, v) => {
      query = q;
      values = v;
      return [];
    };

    await checkPlayerOverlap(
      {},
      {
        date: "2026-09-06",
        utcStart: 1000,
        utcEnd: 2000,
        personIds: [7, 8],
        groupId: 1,
      }
    );

    expect(query).to.include("LEAST(FROM_UNIXTIME(?), UTC_TIMESTAMP()) - INTERVAL 2 DAY");
    expect(query).to.include("a.start_at <= UTC_TIMESTAMP()");
    expect(query).to.include("a.date = ?");
    expect(query).to.not.match(/WHERE\s+a\.date = \?/);
    expect(values).to.deep.equal([1, [[7, 8]], 1000, 2000, 1000, "2026-09-06"]);
  });
});

describe("formatPlayerOverlapMessage", () => {
  it("falls back when there are no rows", () => {
    expect(formatPlayerOverlapMessage([])).to.equal("A player is already booked.");
  });

  it("names the player and court", () => {
    expect(
      formatPlayerOverlapMessage([
        {
          person_id: 1,
          firstname: "Jane",
          lastname: "Doe",
          court_name: "Court 3",
        },
      ])
    ).to.equal("Jane Doe is already booked on Court 3.");
  });

  it("lists each person once", () => {
    expect(
      formatPlayerOverlapMessage([
        {
          person_id: 1,
          firstname: "Jane",
          lastname: "Doe",
          court_name: "Court 3",
        },
        {
          person_id: 1,
          firstname: "Jane",
          lastname: "Doe",
          court_name: "Court 4",
        },
        {
          person_id: 2,
          firstname: "John",
          lastname: "Smith",
          court_name: "Court 1",
        },
      ])
    ).to.equal(
      "Jane Doe is already booked on Court 3. John Smith is already booked on Court 1."
    );
  });

  it("falls back when the row has no name", () => {
    expect(formatPlayerOverlapMessage([{}])).to.equal(
      "A player is already booked on another court."
    );
  });
});
