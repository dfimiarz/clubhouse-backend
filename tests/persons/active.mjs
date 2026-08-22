import { expect } from "chai";
import express from "express";
import request from "supertest";

import personsRouter from "../../persons/api.js";
import personsController from "../../persons/controller.js";
import sqlconnector from "../../db/SqlConnector.js";
import redisconnector from "../../db/RedisConnector.js";
import errorHandler from "../../utils/errorHandler.js";

const originalGetActivePersons = personsController.getActivePersons;
const originalGetConnection = sqlconnector.getConnection;
const originalRunQuery = sqlconnector.runQuery;
const originalRunExecute = sqlconnector.runExecute;
const originalGetJSON = redisconnector.getJSON;
const originalStoreJSON = redisconnector.storeJSON;

function createApp({ userauth = true } = {}) {
  const app = express();
  app.use((_req, res, next) => {
    res.locals.userauth = userauth;
    next();
  });
  app.use("/persons", personsRouter);
  app.use(errorHandler);

  return app;
}

describe("GET /persons/active route", () => {
  let receivedFilters;

  beforeEach(() => {
    receivedFilters = undefined;
    personsController.getActivePersons = async (filters) => {
      receivedFilters = filters;
      return [{ id: 1 }];
    };
  });

  afterEach(() => {
    personsController.getActivePersons = originalGetActivePersons;
  });

  it("rejects unauthenticated requests", async () => {
    const response = await request(createApp({ userauth: false })).get(
      "/persons/active"
    );

    expect(response.status).to.equal(401);
    expect(receivedFilters).to.equal(undefined);
  });

  it("returns the full active list when no params are given", async () => {
    const response = await request(createApp()).get("/persons/active");

    expect(response.status).to.equal(200);
    expect(response.body).to.deep.equal([{ id: 1 }]);
    expect(receivedFilters).to.deep.equal({
      search: undefined,
      ids: undefined,
      host: false,
    });
  });

  it("passes a trimmed search term to the controller", async () => {
    const response = await request(createApp()).get(
      "/persons/active?search=%20Doe%20"
    );

    expect(response.status).to.equal(200);
    expect(receivedFilters.search).to.equal("Doe");
  });

  it("rejects a search term shorter than 2 characters", async () => {
    const response = await request(createApp()).get("/persons/active?search=a");

    expect(response.status).to.equal(422);
    expect(response.body.fielderrors).to.deep.include({
      param: "search",
      msg: "Search must be between 2 and 50 characters",
    });
  });

  it("rejects a search term longer than 50 characters", async () => {
    const response = await request(createApp()).get(
      `/persons/active?search=${"a".repeat(51)}`
    );

    expect(response.status).to.equal(422);
    expect(response.body.fielderrors).to.deep.include({
      param: "search",
      msg: "Search must be between 2 and 50 characters",
    });
  });

  it("parses ids into an array of numbers", async () => {
    const response = await request(createApp()).get(
      "/persons/active?ids=5,10,15"
    );

    expect(response.status).to.equal(200);
    expect(receivedFilters.ids).to.deep.equal([5, 10, 15]);
  });

  it("rejects ids that are not a comma separated list of integers", async () => {
    for (const ids of ["1,a", "1,,2", "1;2", "-1"]) {
      const response = await request(createApp()).get(
        `/persons/active?ids=${encodeURIComponent(ids)}`
      );

      expect(response.status).to.equal(422);
      expect(response.body.fielderrors).to.deep.include({
        param: "ids",
        msg: "ids must be a comma separated list of integers",
      });
    }
  });

  it("rejects more than 10 ids", async () => {
    const ids = Array.from({ length: 11 }, (_v, i) => i + 1).join(",");

    const response = await request(createApp()).get(
      `/persons/active?ids=${ids}`
    );

    expect(response.status).to.equal(422);
    expect(response.body.fielderrors).to.deep.include({
      param: "ids",
      msg: "Too many ids",
    });
  });

  it("maps host=1 to a boolean filter", async () => {
    const response = await request(createApp()).get("/persons/active?host=1");

    expect(response.status).to.equal(200);
    expect(receivedFilters.host).to.equal(true);
  });

  it("rejects host values other than 1", async () => {
    const response = await request(createApp()).get("/persons/active?host=0");

    expect(response.status).to.equal(422);
    expect(response.body.fielderrors).to.deep.include({
      param: "host",
      msg: "host must be 1",
    });
  });

  it("propagates controller errors to the error handler", async () => {
    personsController.getActivePersons = async () => {
      throw new Error("db down");
    };

    const response = await request(createApp()).get("/persons/active");

    expect(response.status).to.equal(500);
    expect(response.body).to.deep.equal({ errors: "Something went wrong" });
  });
});

describe("getActivePersons controller", () => {
  let queries;
  let released;
  let memberRows;
  let passRows;
  let settingRows;
  let cachedList;
  let stored;

  beforeEach(() => {
    queries = [];
    released = false;
    memberRows = [];
    passRows = [];
    settingRows = [];
    cachedList = null; // default: cache miss, fall back to the DB
    stored = undefined;

    redisconnector.getJSON = async () => cachedList;
    redisconnector.storeJSON = async (_key, data) => {
      stored = data;
    };

    // The controller borrows its connection through withConnection, which calls
    // api.getConnection() — so stubbing the export here intercepts it and the
    // real withConnection still runs, meaning `released` reflects its actual
    // release-in-finally behaviour rather than a copy of it.
    sqlconnector.getConnection = async () => ({
      release() {
        released = true;
      },
    });

    // Record through both helpers so the assertions stay valid whichever
    // protocol the controller uses; swapping one for the other is exactly what
    // silently broke these tests during the mysql2 migration.
    const record = async (_connection, query, values) => {
      queries.push({ query, values });
      if (query.includes("guest_pass_type_setting")) {
        return settingRows;
      }
      return query.includes("guest_pass") ? passRows : memberRows;
    };
    sqlconnector.runQuery = record;
    sqlconnector.runExecute = record;
  });

  afterEach(() => {
    sqlconnector.getConnection = originalGetConnection;
    sqlconnector.runQuery = originalRunQuery;
    sqlconnector.runExecute = originalRunExecute;
    redisconnector.getJSON = originalGetJSON;
    redisconnector.storeJSON = originalStoreJSON;
  });

  function memberQuery() {
    const entry = queries.find((q) => q.query.includes("membership_view"));
    expect(entry, "member query was not run").to.not.equal(undefined);
    return entry;
  }

  describe("on a cache miss", () => {
    it("queries the unfiltered active list and caches it", async () => {
      memberRows = [{ id: 1, firstname: "Jane", lastname: "Doe" }];

      const result = await personsController.getActivePersons();

      const { query, values } = memberQuery();
      expect(query).to.not.include("LIKE");
      expect(query).to.not.include("m.id IN");
      expect(query).to.not.include("guest_host");
      expect(values).to.deep.equal([process.env.CLUB_ID]);
      expect(released).to.equal(true);
      expect(stored).to.deep.equal(memberRows);
      expect(result).to.deep.equal(memberRows);
    });

    it("attaches active passes to pass-requiring persons only", async () => {
      memberRows = [
        { id: 1, requires_pass: 1 },
        { id: 2, requires_pass: 1 },
        { id: 3, requires_pass: 0 },
      ];
      passRows = [
        { id: 71, guest_id: 1, type: 2, label: "Season Pass" },
        { id: 72, guest_id: 3, type: 2, label: "Season Pass" },
      ];

      const persons = await personsController.getActivePersons();

      expect(persons[0].pass).to.deep.equal({
        id: 71,
        type: 2,
        label: "Season Pass",
        settings: { play_after: null },
        constraints: [],
      });
      expect(persons[1].pass).to.equal(undefined);
      expect(persons[2].pass).to.equal(undefined);
    });

    it("attaches resolved pass-type settings to the active pass", async () => {
      memberRows = [{ id: 1, requires_pass: 1 }];
      passRows = [{ id: 71, guest_id: 1, type: 2, label: "Season Pass" }];
      settingRows = [
        { pass_type: 2, setting_key: "play_after", setting_value: "12:00" },
      ];

      const persons = await personsController.getActivePersons();

      expect(persons[0].pass.settings).to.deep.equal({ play_after: "12:00" });
      expect(persons[0].pass.constraints).to.deep.equal([
        { key: "play_after", text: "Play at or after 12:00" },
      ]);
    });

    it("releases the connection when a query fails", async () => {
      const fail = async () => {
        throw new Error("query failed");
      };
      sqlconnector.runQuery = fail;
      sqlconnector.runExecute = fail;

      try {
        await personsController.getActivePersons();
        expect.fail("expected getActivePersons to throw");
      } catch (err) {
        expect(err.message).to.equal("query failed");
      }

      expect(released).to.equal(true);
    });
  });

  describe("on a cache hit", () => {
    beforeEach(() => {
      cachedList = [
        { id: 1, firstname: "Jane", lastname: "Doe", guest_host: 1 },
        { id: 2, firstname: "John", lastname: "Adams", guest_host: 0 },
        { id: 3, firstname: "Amy", lastname: "Doe", guest_host: 0 },
      ];
    });

    it("does not touch the database", async () => {
      await personsController.getActivePersons();

      expect(queries).to.have.lengthOf(0);
    });

    it("returns the full list when no filters are given", async () => {
      const result = await personsController.getActivePersons();

      expect(result).to.deep.equal(cachedList);
    });

    it("restricts to guest hosts when host is set", async () => {
      const result = await personsController.getActivePersons({ host: true });

      expect(result.map((p) => p.id)).to.deep.equal([1]);
    });

    it("filters by ids when provided", async () => {
      const result = await personsController.getActivePersons({ ids: [2, 3] });

      expect(result.map((p) => p.id)).to.deep.equal([2, 3]);
    });

    it("matches ids after number conversion", async () => {
      cachedList = [
        { id: "2", firstname: "John", lastname: "Adams" },
        { id: 3, firstname: "Amy", lastname: "Doe" },
      ];

      const result = await personsController.getActivePersons({ ids: [2, 3] });

      expect(result.map((p) => Number(p.id))).to.deep.equal([2, 3]);
    });

    it("gives ids precedence over search", async () => {
      const result = await personsController.getActivePersons({
        ids: [2],
        search: "Doe",
      });

      expect(result.map((p) => p.id)).to.deep.equal([2]);
    });

    it("searches first, last, and full name, sorted by name", async () => {
      const result = await personsController.getActivePersons({ search: "doe" });

      // Jane Doe (1) and Amy Doe (3), sorted by lastname then firstname
      expect(result.map((p) => p.id)).to.deep.equal([3, 1]);
    });

    it("matches on the full name", async () => {
      const result = await personsController.getActivePersons({
        search: "jane d",
      });

      expect(result.map((p) => p.id)).to.deep.equal([1]);
    });

    it("matches accented names with an unaccented search term", async () => {
      cachedList = [
        { id: 1, firstname: "José", lastname: "Muñoz" },
        { id: 2, firstname: "Jane", lastname: "Doe" },
      ];

      const byFirst = await personsController.getActivePersons({
        search: "jose",
      });
      const byLast = await personsController.getActivePersons({
        search: "munoz",
      });

      expect(byFirst.map((p) => p.id)).to.deep.equal([1]);
      expect(byLast.map((p) => p.id)).to.deep.equal([1]);
    });

    it("matches unaccented names with an accented search term", async () => {
      cachedList = [
        { id: 1, firstname: "Jose", lastname: "Munoz" },
        { id: 2, firstname: "Jane", lastname: "Doe" },
      ];

      const result = await personsController.getActivePersons({
        search: "José",
      });

      expect(result.map((p) => p.id)).to.deep.equal([1]);
    });

    it("limits search results to 20", async () => {
      cachedList = Array.from({ length: 25 }, (_v, i) => ({
        id: i + 1,
        firstname: "Sam",
        lastname: `Smith${String(i).padStart(2, "0")}`,
      }));

      const result = await personsController.getActivePersons({
        search: "smith",
      });

      expect(result).to.have.lengthOf(20);
    });
  });
});
