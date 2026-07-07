import { expect } from "chai";
import express from "express";
import request from "supertest";

import personsRouter from "../../persons/api.js";
import personsController from "../../persons/controller.js";
import sqlconnector from "../../db/SqlConnector.js";
import constants from "../../utils/dbconstants.js";
import RESTError from "../../utils/RESTError.js";

const originalGetActivePersons = personsController.getActivePersons;
const originalGetConnection = sqlconnector.getConnection;
const originalRunQuery = sqlconnector.runQuery;

function createApp({ userauth = true } = {}) {
  const app = express();
  app.use((_req, res, next) => {
    res.locals.userauth = userauth;
    next();
  });
  app.use("/persons", personsRouter);
  app.use((err, _req, res, _next) => {
    if (err instanceof RESTError) {
      res.status(err.status).json(err.payload);
      return;
    }

    res.status(err.status || 500).json(err.message || "Something went wrong");
  });

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
  });
});

describe("getActivePersons controller", () => {
  let queries;
  let released;
  let memberRows;
  let passRows;

  beforeEach(() => {
    queries = [];
    released = false;
    memberRows = [];
    passRows = [];

    sqlconnector.getConnection = async () => ({
      release() {
        released = true;
      },
    });
    sqlconnector.runQuery = async (_connection, query, values) => {
      queries.push({ query, values });
      return query.includes("guest_pass") ? passRows : memberRows;
    };
  });

  afterEach(() => {
    sqlconnector.getConnection = originalGetConnection;
    sqlconnector.runQuery = originalRunQuery;
  });

  function memberQuery() {
    const entry = queries.find((q) => q.query.includes("membership_view"));
    expect(entry, "member query was not run").to.not.equal(undefined);
    return entry;
  }

  it("queries the unfiltered active list by default", async () => {
    await personsController.getActivePersons();

    const { query, values } = memberQuery();
    expect(query).to.not.include("LIKE");
    expect(query).to.not.include("m.id IN");
    expect(query).to.not.include("guest_host");
    expect(values).to.deep.equal([process.env.CLUB_ID]);
    expect(released).to.equal(true);
  });

  it("restricts to guest hosts when host is set", async () => {
    await personsController.getActivePersons({ host: true });

    const { query } = memberQuery();
    expect(query).to.include("m.guest_host = 1");
  });

  it("filters by ids when provided", async () => {
    await personsController.getActivePersons({ ids: [4, 8] });

    const { query, values } = memberQuery();
    expect(query).to.include("m.id IN (?)");
    expect(values).to.deep.equal([process.env.CLUB_ID, [4, 8]]);
  });

  it("gives ids precedence over search", async () => {
    await personsController.getActivePersons({ ids: [4], search: "Doe" });

    const { query } = memberQuery();
    expect(query).to.include("m.id IN (?)");
    expect(query).to.not.include("LIKE");
  });

  it("searches first, last, and full name with a limit of 20", async () => {
    await personsController.getActivePersons({ search: "Doe" });

    const { query, values } = memberQuery();
    expect(query.match(/LIKE \?/g)).to.have.lengthOf(3);
    expect(query).to.include("LIMIT 20");
    expect(values).to.deep.equal([
      process.env.CLUB_ID,
      "%Doe%",
      "%Doe%",
      "%Doe%",
    ]);
  });

  it("escapes LIKE wildcards in the search term", async () => {
    await personsController.getActivePersons({ search: "Mc%_" });

    const { values } = memberQuery();
    expect(values[1]).to.equal("%Mc\\%\\_%");
  });

  it("attaches active passes to guests only", async () => {
    const GUEST = constants.ROLE_TYPES.GUEST_TYPE;
    memberRows = [
      { id: 1, role_type_id: GUEST },
      { id: 2, role_type_id: GUEST },
      { id: 3, role_type_id: GUEST + 1 },
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
    });
    expect(persons[1].pass).to.equal(undefined);
    expect(persons[2].pass).to.equal(undefined);
  });

  it("releases the connection when a query fails", async () => {
    sqlconnector.runQuery = async () => {
      throw new Error("query failed");
    };

    try {
      await personsController.getActivePersons();
      expect.fail("expected getActivePersons to throw");
    } catch (err) {
      expect(err.message).to.equal("query failed");
    }

    expect(released).to.equal(true);
  });
});
