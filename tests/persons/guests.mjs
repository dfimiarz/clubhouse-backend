import { expect } from "chai";

import personsController from "../../persons/controller.js";
import sqlconnector from "../../db/SqlConnector.js";
import redisconnector from "../../db/RedisConnector.js";
import RESTError from "../../utils/RESTError.js";

const { addGuest } = personsController;

const originalWithTransaction = sqlconnector.withTransaction;
const originalRunQuery = sqlconnector.runQuery;
const originalRunExecute = sqlconnector.runExecute;
const originalDeleteKey = redisconnector.deleteKey;

const CURRENT_SEASON = {
  time_zone: "America/New_York",
  season_start: "2026-04-25",
  season_end: "2026-12-31",
};

function guestRequest(overrides = {}) {
  return {
    body: {
      firstname: "Jane",
      lastname: "Doe",
      email: "jane@example.com",
      phone: "212-555-0100",
      ...overrides,
    },
  };
}

describe("addGuest duplicate disclosure", () => {
  let inserts;
  let cacheDeletes;
  let emailMatch;
  let identityMatch;
  let seasonRows;
  let overlappingMemberships;

  beforeEach(() => {
    inserts = [];
    cacheDeletes = 0;
    emailMatch = [];
    identityMatch = [];
    seasonRows = [{ ...CURRENT_SEASON }];
    overlappingMemberships = [];

    sqlconnector.withTransaction = async (fn) => fn({});
    sqlconnector.runQuery = async (_connection, query) => {
      return query.includes("email") ? emailMatch : identityMatch;
    };
    sqlconnector.runExecute = async (_connection, query, values) => {
      if (query.includes("club_seasons")) {
        return seasonRows;
      }
      if (query.includes("FOR UPDATE") && query.includes("membership")) {
        return overlappingMemberships;
      }
      inserts.push({ query, values });
      return { insertId: 99 };
    };
    redisconnector.deleteKey = async () => {
      cacheDeletes += 1;
    };
  });

  afterEach(() => {
    sqlconnector.withTransaction = originalWithTransaction;
    sqlconnector.runQuery = originalRunQuery;
    sqlconnector.runExecute = originalRunExecute;
    redisconnector.deleteKey = originalDeleteKey;
  });

  it("returns 400 when there is no current club season", async () => {
    seasonRows = [];

    try {
      await addGuest(guestRequest(), { discloseDuplicates: false });
      expect.fail("expected addGuest to throw");
    } catch (err) {
      expect(err).to.be.instanceOf(RESTError);
      expect(err.status).to.equal(400);
      expect(err.payload).to.equal(
        "Guest registration is not available outside the season"
      );
    }

    expect(inserts).to.have.lengthOf(0);
    expect(cacheDeletes).to.equal(0);
  });

  it("returns 409 on email for authenticated callers and does not insert", async () => {
    emailMatch = [{ id: 7 }];
    overlappingMemberships = [
      {
        record_id: 1,
        role: 500,
        valid_from: "2026-04-25",
        valid_until: "2026-12-31",
      },
    ];

    try {
      await addGuest(guestRequest(), { discloseDuplicates: true });
      expect.fail("expected addGuest to throw");
    } catch (err) {
      expect(err).to.be.instanceOf(RESTError);
      expect(err.status).to.equal(409);
      expect(err.payload).to.deep.equal({
        fielderrors: [{ param: "email", msg: "Guest already exists" }],
      });
    }

    expect(inserts).to.have.lengthOf(0);
    expect(cacheDeletes).to.equal(0);
  });

  it("returns 409 on phone for authenticated name+phone matches", async () => {
    identityMatch = [{ id: 8 }];
    overlappingMemberships = [
      {
        record_id: 2,
        role: 500,
        valid_from: "2026-04-25",
        valid_until: "2026-12-31",
      },
    ];

    try {
      await addGuest(guestRequest(), { discloseDuplicates: true });
      expect.fail("expected addGuest to throw");
    } catch (err) {
      expect(err).to.be.instanceOf(RESTError);
      expect(err.status).to.equal(409);
      expect(err.payload).to.deep.equal({
        fielderrors: [{ param: "phone", msg: "Guest already exists" }],
      });
    }

    expect(inserts).to.have.lengthOf(0);
  });

  it("treats a future overlapping membership as already registered", async () => {
    emailMatch = [{ id: 7 }];
    overlappingMemberships = [
      {
        record_id: 3,
        role: 2000,
        valid_from: "2026-10-01",
        valid_until: "2026-12-31",
      },
    ];

    try {
      await addGuest(guestRequest(), { discloseDuplicates: true });
      expect.fail("expected addGuest to throw");
    } catch (err) {
      expect(err).to.be.instanceOf(RESTError);
      expect(err.status).to.equal(409);
    }

    expect(inserts).to.have.lengthOf(0);
    expect(cacheDeletes).to.equal(0);
  });

  it("silently no-ops an email duplicate for anonymous callers", async () => {
    emailMatch = [{ id: 7 }];
    overlappingMemberships = [
      {
        record_id: 1,
        role: 500,
        valid_from: "2026-04-25",
        valid_until: "2026-12-31",
      },
    ];

    const result = await addGuest(guestRequest(), {
      discloseDuplicates: false,
    });

    expect(result).to.deep.equal({ outcome: "created" });
    expect(inserts).to.have.lengthOf(0);
    expect(cacheDeletes).to.equal(0);
  });

  it("silently no-ops a name+phone duplicate for anonymous callers", async () => {
    identityMatch = [{ id: 8 }];
    overlappingMemberships = [
      {
        record_id: 2,
        role: 500,
        valid_from: "2026-04-25",
        valid_until: "2026-12-31",
      },
    ];

    const result = await addGuest(guestRequest(), {
      discloseDuplicates: false,
    });

    expect(result).to.deep.equal({ outcome: "created" });
    expect(inserts).to.have.lengthOf(0);
    expect(cacheDeletes).to.equal(0);
  });

  it("restores guest membership for an inactive email match", async () => {
    emailMatch = [{ id: 7 }];

    const result = await addGuest(guestRequest(), {
      discloseDuplicates: true,
    });

    expect(result).to.deep.equal({ outcome: "reactivated" });
    expect(inserts).to.have.lengthOf(1);
    expect(inserts[0].query).to.include("INSERT INTO `membership`");
    expect(inserts[0].values).to.deep.equal([
      7,
      CURRENT_SEASON.time_zone,
      CURRENT_SEASON.season_end,
      500,
    ]);
    expect(cacheDeletes).to.equal(1);
  });

  it("restores guest membership for an inactive name+phone match", async () => {
    identityMatch = [{ id: 8 }];

    const result = await addGuest(guestRequest(), {
      discloseDuplicates: true,
    });

    expect(result).to.deep.equal({ outcome: "reactivated" });
    expect(inserts).to.have.lengthOf(1);
    expect(inserts[0].query).to.include("INSERT INTO `membership`");
    expect(inserts[0].values[0]).to.equal(8);
    expect(cacheDeletes).to.equal(1);
  });

  it("masks a reactivation as created for anonymous callers", async () => {
    emailMatch = [{ id: 7 }];

    const result = await addGuest(guestRequest(), {
      discloseDuplicates: false,
    });

    expect(result).to.deep.equal({ outcome: "created" });
    expect(inserts).to.have.lengthOf(1);
    expect(inserts[0].query).to.include("INSERT INTO `membership`");
    expect(inserts[0].values[0]).to.equal(7);
    expect(cacheDeletes).to.equal(1);
  });

  it("treats a unique-key race as success for anonymous callers", async () => {
    sqlconnector.runExecute = async (_connection, query) => {
      if (query.includes("club_seasons")) {
        return seasonRows;
      }
      const error = new Error("Duplicate entry");
      error.errno = 1062;
      throw error;
    };

    const result = await addGuest(guestRequest(), {
      discloseDuplicates: false,
    });

    expect(result).to.deep.equal({ outcome: "created" });
    expect(cacheDeletes).to.equal(0);
  });

  it("treats an overlapping-membership race as success for anonymous callers", async () => {
    emailMatch = [{ id: 7 }];
    sqlconnector.runExecute = async (_connection, query) => {
      if (query.includes("club_seasons")) {
        return seasonRows;
      }
      if (query.includes("FOR UPDATE") && query.includes("membership")) {
        return [];
      }
      const error = new Error("User roles cannot overlap");
      error.errno = 1644;
      throw error;
    };

    const result = await addGuest(guestRequest(), {
      discloseDuplicates: false,
    });

    expect(result).to.deep.equal({ outcome: "created" });
    expect(cacheDeletes).to.equal(0);
  });

  it("still maps a unique-key race to a client error when disclosing", async () => {
    sqlconnector.runExecute = async (_connection, query) => {
      if (query.includes("club_seasons")) {
        return seasonRows;
      }
      const error = new Error("Duplicate entry");
      error.errno = 1062;
      throw error;
    };

    try {
      await addGuest(guestRequest(), { discloseDuplicates: true });
      expect.fail("expected addGuest to throw");
    } catch (err) {
      expect(err).to.be.instanceOf(RESTError);
      expect(err.status).to.equal(422);
      expect(err.payload).to.equal("Person already exists");
    }
  });

  it("inserts a season-bounded membership and invalidates the cache when the guest is new", async () => {
    const result = await addGuest(guestRequest(), {
      discloseDuplicates: false,
    });

    expect(result).to.deep.equal({ outcome: "created" });
    expect(inserts).to.have.lengthOf(2);
    expect(inserts[0].query).to.include("INSERT INTO `person`");
    expect(inserts[1].query).to.include("INSERT INTO `membership`");
    expect(inserts[1].values).to.deep.equal([
      99,
      CURRENT_SEASON.time_zone,
      CURRENT_SEASON.season_end,
      500,
    ]);
    expect(cacheDeletes).to.equal(1);
  });
});
