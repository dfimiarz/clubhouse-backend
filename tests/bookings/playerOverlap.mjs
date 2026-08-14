import { expect } from "chai";

import playerOverlap from "../../bookings/playerOverlap.js";
import playerType from "../../bookings/playerType.js";

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

describe("formatPlayerOverlapMessage", () => {
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
    ).to.equal("Jane Doe is already booked on Court 3 at this time.");
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
      "Jane Doe is already booked on Court 3 at this time. John Smith is already booked on Court 1 at this time."
    );
  });

  it("falls back when the row has no name", () => {
    expect(formatPlayerOverlapMessage([{}])).to.equal(
      "A player is already booked on another court at this time."
    );
  });
});
