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

  beforeEach(() => {
    inserts = [];
    cacheDeletes = 0;
    emailMatch = [];
    identityMatch = [];

    sqlconnector.withTransaction = async (fn) => fn({});
    sqlconnector.runQuery = async (_connection, query) => {
      return query.includes("email") ? emailMatch : identityMatch;
    };
    sqlconnector.runExecute = async (_connection, query, values) => {
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

  it("returns 409 on email for authenticated callers and does not insert", async () => {
    emailMatch = [{ id: 7 }];

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

  it("silently no-ops an email duplicate for anonymous callers", async () => {
    emailMatch = [{ id: 7 }];

    await addGuest(guestRequest(), { discloseDuplicates: false });

    expect(inserts).to.have.lengthOf(0);
    expect(cacheDeletes).to.equal(0);
  });

  it("silently no-ops a name+phone duplicate for anonymous callers", async () => {
    identityMatch = [{ id: 8 }];

    await addGuest(guestRequest(), { discloseDuplicates: false });

    expect(inserts).to.have.lengthOf(0);
    expect(cacheDeletes).to.equal(0);
  });

  it("treats a unique-key race as success for anonymous callers", async () => {
    sqlconnector.runExecute = async () => {
      const error = new Error("Duplicate entry");
      error.errno = 1062;
      throw error;
    };

    await addGuest(guestRequest(), { discloseDuplicates: false });

    expect(cacheDeletes).to.equal(0);
  });

  it("still maps a unique-key race to a client error when disclosing", async () => {
    sqlconnector.runExecute = async () => {
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

  it("inserts and invalidates the cache when the guest is new", async () => {
    await addGuest(guestRequest(), { discloseDuplicates: false });

    expect(inserts).to.have.lengthOf(2);
    expect(inserts[0].query).to.include("INSERT INTO `person`");
    expect(inserts[1].query).to.include("INSERT INTO `membership`");
    expect(cacheDeletes).to.equal(1);
  });
});
