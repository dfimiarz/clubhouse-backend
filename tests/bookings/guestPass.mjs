import { expect } from "chai";

import guestPass from "../../bookings/guestPass.js";
import sqlconnector from "../../db/SqlConnector.js";
import RESTError from "../../utils/RESTError.js";

const {
  SETTING_KEY,
  formatMissingGuestPassMessage,
  formatPlayAfterMessage,
  guestsMissingCoveringPass,
  guestsAreUnaccompanied,
  assertGuestsAccompaniedByMember,
  assertGuestsHaveValidPasses,
} = guestPass;

const originalRunQuery = sqlconnector.runQuery;

describe("formatMissingGuestPassMessage", () => {
  it("names each guest once", () => {
    expect(
      formatMissingGuestPassMessage([
        { id: 1, firstname: "Jane", lastname: "Doe" },
        { id: 1, firstname: "Jane", lastname: "Doe" },
        { id: 2, firstname: "John", lastname: "Smith" },
      ])
    ).to.equal(
      "Jane Doe does not have a valid guest pass. John Smith does not have a valid guest pass."
    );
  });

  it("falls back when the row has no name", () => {
    expect(formatMissingGuestPassMessage([{}])).to.equal(
      "A guest does not have a valid guest pass."
    );
  });

  it("falls back when the list is empty", () => {
    expect(formatMissingGuestPassMessage([])).to.equal(
      "A guest does not have a valid guest pass."
    );
  });
});

describe("formatPlayAfterMessage", () => {
  it("names each guest once with the earliest play_after", () => {
    expect(
      formatPlayAfterMessage([
        { id: 1, firstname: "Jane", lastname: "Doe", play_after: "12:00" },
        { id: 1, firstname: "Jane", lastname: "Doe", play_after: "12:00" },
      ])
    ).to.equal("Jane Doe's guest pass does not allow play before 12:00.");
  });

  it("falls back when the list is empty", () => {
    expect(formatPlayAfterMessage([])).to.equal(
      "A guest's guest pass does not allow play before this time."
    );
  });
});

describe("guestsMissingCoveringPass", () => {
  const guests = [
    { id: 1, firstname: "Jane" },
    { id: 2, firstname: "John" },
  ];

  it("returns guests whose id is not in the covering set", () => {
    expect(guestsMissingCoveringPass(guests, [2])).to.deep.equal([
      { id: 1, firstname: "Jane" },
    ]);
  });

  it("treats string ids as covered", () => {
    expect(guestsMissingCoveringPass(guests, ["1", "2"])).to.deep.equal([]);
  });

  it("returns every guest when none are covered", () => {
    expect(guestsMissingCoveringPass(guests, [])).to.deep.equal(guests);
  });
});

describe("guestsAreUnaccompanied", () => {
  it("is false when there are no guests", () => {
    expect(guestsAreUnaccompanied([1, 2], [])).to.equal(false);
  });

  it("is false when a guest is booked with a member", () => {
    expect(guestsAreUnaccompanied([1, 2], [{ id: 2 }])).to.equal(false);
  });

  it("is true for a solo guest", () => {
    expect(guestsAreUnaccompanied([2], [{ id: 2 }])).to.equal(true);
  });

  it("is true when every player is a guest", () => {
    expect(
      guestsAreUnaccompanied([2, 3], [{ id: 2 }, { id: 3 }])
    ).to.equal(true);
  });
});

describe("assertGuestsAccompaniedByMember", () => {
  afterEach(() => {
    sqlconnector.runQuery = originalRunQuery;
  });

  /**
   * @param {{ settingValue?: string, guests?: Array }} opts
   */
  function mockQueries({ settingValue, guests = [] } = {}) {
    sqlconnector.runQuery = async (_connection, query) => {
      if (query.includes("club_setting")) {
        if (settingValue === undefined) {
          return [];
        }
        return [{ setting_key: SETTING_KEY, setting_value: settingValue }];
      }
      if (query.includes("requires_pass")) {
        return guests;
      }
      throw new Error(`unexpected query: ${query}`);
    };
  }

  it("does not query when the roster is empty", async () => {
    let called = false;
    sqlconnector.runQuery = async () => {
      called = true;
      return [];
    };

    await assertGuestsAccompaniedByMember({}, { date: "2026-08-14", players: [] });
    expect(called).to.equal(false);
  });

  it("skips the check when the club flag is off", async () => {
    const queries = [];
    sqlconnector.runQuery = async (_connection, query) => {
      queries.push(query);
      if (query.includes("club_setting")) {
        return [{ setting_key: SETTING_KEY, setting_value: "0" }];
      }
      throw new Error("should not query guests when the flag is off");
    };

    await assertGuestsAccompaniedByMember(
      {},
      {
        date: "2026-08-14",
        players: [{ person_id: 10 }],
      }
    );

    expect(queries).to.have.length(1);
  });

  it("accepts a guest booked with a member when the flag is on", async () => {
    mockQueries({
      guests: [{ id: 10, firstname: "Jane", lastname: "Doe" }],
    });

    await assertGuestsAccompaniedByMember(
      {},
      {
        date: "2026-08-14",
        players: [{ person_id: 10 }, { person_id: 20 }],
      }
    );
  });

  it("rejects a guest-only roster when the flag is on by default", async () => {
    mockQueries({
      guests: [{ id: 10, firstname: "Jane", lastname: "Doe" }],
    });

    try {
      await assertGuestsAccompaniedByMember(
        {},
        {
          date: "2026-08-14",
          players: [{ person_id: 10 }],
        }
      );
      expect.fail("expected RESTError");
    } catch (error) {
      expect(error).to.be.instanceOf(RESTError);
      expect(error.status).to.equal(422);
      expect(error.payload).to.equal("A guest cannot book without a member.");
    }
  });
});

describe("assertGuestsHaveValidPasses", () => {
  afterEach(() => {
    sqlconnector.runQuery = originalRunQuery;
  });

  it("does not query when the roster is empty", async () => {
    let called = false;
    sqlconnector.runQuery = async () => {
      called = true;
      return [];
    };

    await assertGuestsHaveValidPasses({}, { date: "2026-08-14", start: "09:00", players: [] });
    expect(called).to.equal(false);
  });

  it("does not query guest_pass when nobody requires a pass", async () => {
    const queries = [];
    sqlconnector.runQuery = async (_connection, query) => {
      queries.push(query);
      return [];
    };

    await assertGuestsHaveValidPasses(
      {},
      {
        date: "2026-08-14",
        start: "09:00",
        players: [{ person_id: 10 }],
      }
    );

    expect(queries).to.have.length(1);
    expect(queries[0]).to.include("requires_pass");
    expect(queries[0]).to.not.include("guest_pass");
  });

  it("accepts a guest whose pass covers the session start", async () => {
    sqlconnector.runQuery = async (_connection, query) => {
      if (query.includes("requires_pass")) {
        return [{ id: 10, firstname: "Jane", lastname: "Doe" }];
      }
      if (query.includes("guest_pass")) {
        return [{ guest_id: 10 }];
      }
      throw new Error(`unexpected query: ${query}`);
    };

    await assertGuestsHaveValidPasses(
      {},
      {
        date: "2026-08-14",
        start: "09:00",
        players: [{ person_id: 10 }],
      }
    );
  });

  it("accepts a guest whose pass covers the start at play_after", async () => {
    sqlconnector.runQuery = async (_connection, query) => {
      if (query.includes("requires_pass")) {
        return [{ id: 10, firstname: "Jane", lastname: "Doe" }];
      }
      if (query.includes("guest_pass_type_setting")) {
        return [{ pass_type: 2, setting_key: "play_after", setting_value: "12:00" }];
      }
      if (query.includes("guest_pass")) {
        return [{ guest_id: 10, type: 2 }];
      }
      throw new Error(`unexpected query: ${query}`);
    };

    await assertGuestsHaveValidPasses(
      {},
      {
        date: "2026-08-14",
        start: "12:00",
        players: [{ person_id: 10 }],
      }
    );
  });

  it("rejects a guest whose covering pass does not allow the start", async () => {
    sqlconnector.runQuery = async (_connection, query) => {
      if (query.includes("requires_pass")) {
        return [{ id: 10, firstname: "Jane", lastname: "Doe" }];
      }
      if (query.includes("guest_pass_type_setting")) {
        return [{ pass_type: 2, setting_key: "play_after", setting_value: "12:00" }];
      }
      if (query.includes("guest_pass")) {
        return [{ guest_id: 10, type: 2 }];
      }
      throw new Error(`unexpected query: ${query}`);
    };

    try {
      await assertGuestsHaveValidPasses(
        {},
        {
          date: "2026-08-14",
          start: "09:00",
          players: [{ person_id: 10 }],
        }
      );
      expect.fail("expected RESTError");
    } catch (error) {
      expect(error).to.be.instanceOf(RESTError);
      expect(error.status).to.equal(422);
      expect(error.payload).to.equal(
        "Jane Doe's guest pass does not allow play before 12:00."
      );
    }
  });

  it("accepts a guest when one of two covering types allows the start", async () => {
    sqlconnector.runQuery = async (_connection, query) => {
      if (query.includes("requires_pass")) {
        return [{ id: 10, firstname: "Jane", lastname: "Doe" }];
      }
      if (query.includes("guest_pass_type_setting")) {
        return [
          { pass_type: 2, setting_key: "play_after", setting_value: "14:00" },
          { pass_type: 3, setting_key: "play_after", setting_value: "09:00" },
        ];
      }
      if (query.includes("guest_pass")) {
        return [
          { guest_id: 10, type: 2 },
          { guest_id: 10, type: 3 },
        ];
      }
      throw new Error(`unexpected query: ${query}`);
    };

    await assertGuestsHaveValidPasses(
      {},
      {
        date: "2026-08-14",
        start: "10:00",
        players: [{ person_id: 10 }],
      }
    );
  });

  it("rejects a guest with no covering pass", async () => {
    sqlconnector.runQuery = async (_connection, query) => {
      if (query.includes("requires_pass")) {
        return [{ id: 10, firstname: "Jane", lastname: "Doe" }];
      }
      if (query.includes("guest_pass")) {
        return [];
      }
      throw new Error(`unexpected query: ${query}`);
    };

    try {
      await assertGuestsHaveValidPasses(
        {},
        {
          date: "2026-08-14",
          start: "09:00",
          players: [{ person_id: 10 }],
        }
      );
      expect.fail("expected RESTError");
    } catch (error) {
      expect(error).to.be.instanceOf(RESTError);
      expect(error.status).to.equal(422);
      expect(error.payload).to.equal("Jane Doe does not have a valid guest pass.");
    }
  });
});
