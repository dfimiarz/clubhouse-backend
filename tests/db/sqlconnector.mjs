import { expect } from "chai";

import sqlconnector from "../../db/SqlConnector.js";
import logger from "../../utils/logger/logger.js";

// A connection stand-in: records what reached the driver and returns the
// [rows, fields] shape mysql2 gives back.
function fakeConnection() {
  const calls = [];
  return {
    calls,
    async execute(query, values) {
      calls.push({ query, values });
      return [[{ ok: 1 }], []];
    },
  };
}

describe("SqlConnector.runExecute array guard", () => {
  // execute() uses a server-side prepared statement, which has no client-side
  // nested-array expansion: an array bind is sent as a single scalar and
  // matches nothing instead of erroring. The guard turns that silent empty
  // result into a loud failure. Verified against mysql2 3.23.2 / MySQL 8.2.
  const rejected = [
    ["an IN (?) bind", [[1, 2]]],
    ["a bulk VALUES ? bind", [[[1, 2], [3, 4]]]],
    ["an array inside a named-placeholder object", { ids: [1, 2] }],
  ];

  for (const [label, values] of rejected) {
    it(`rejects ${label}`, async () => {
      const connection = fakeConnection();

      try {
        await sqlconnector.runExecute(connection, "SELECT 1", values);
        expect.fail("expected runExecute to throw");
      } catch (err) {
        expect(err).to.be.instanceOf(TypeError);
        expect(err.message).to.match(/use runQuery/);
      }

      expect(connection.calls, "query must not reach the driver").to.have.lengthOf(0);
    });
  }

  const accepted = [
    ["scalar binds", [1, "two", null]],
    ["an empty bind list", []],
    ["a Date bind", [new Date("2026-01-01T00:00:00Z")]],
    ["named placeholders with scalar values", { club_id: 1, name: "a" }],
  ];

  for (const [label, values] of accepted) {
    it(`allows ${label}`, async () => {
      const connection = fakeConnection();

      const result = await sqlconnector.runExecute(
        connection,
        "SELECT 1",
        values
      );

      expect(connection.calls).to.have.lengthOf(1);
      expect(connection.calls[0].values).to.equal(values);
      expect(result).to.deep.equal([{ ok: 1 }]);
    });
  }

  it("allows an omitted bind list", async () => {
    const connection = fakeConnection();

    await sqlconnector.runExecute(connection, "SELECT 1");

    expect(connection.calls[0].values).to.deep.equal([]);
  });

  it("returns rows only, not the [rows, fields] tuple", async () => {
    const connection = fakeConnection();

    const result = await sqlconnector.runExecute(connection, "SELECT 1", []);

    expect(result).to.deep.equal([{ ok: 1 }]);
  });
});

// Now that withConnection/withTransaction call through the exports object,
// replacing sqlconnector.getConnection actually intercepts them — so these
// wrappers can be tested without a database.
function txConnection({ failOn = null } = {}) {
  const calls = [];
  const fail = (name) => {
    if (failOn === name) throw new Error(`${name} failed`);
  };
  return {
    calls,
    released: 0,
    async query(sql) {
      calls.push(sql);
      return [[], []];
    },
    async beginTransaction() {
      calls.push("BEGIN");
      fail("beginTransaction");
    },
    async commit() {
      calls.push("COMMIT");
      fail("commit");
    },
    async rollback() {
      calls.push("ROLLBACK");
      fail("rollback");
    },
    release() {
      this.released++;
    },
  };
}

describe("SqlConnector.withConnection", () => {
  const original = sqlconnector.getConnection;
  let connection;

  beforeEach(() => {
    connection = txConnection();
    sqlconnector.getConnection = async () => connection;
  });

  afterEach(() => {
    sqlconnector.getConnection = original;
  });

  it("passes the borrowed connection to the callback and returns its result", async () => {
    const result = await sqlconnector.withConnection(async (c) => {
      expect(c).to.equal(connection);
      return "value";
    });

    expect(result).to.equal("value");
  });

  it("releases the connection on success", async () => {
    await sqlconnector.withConnection(async () => "ok");

    expect(connection.released).to.equal(1);
  });

  it("releases the connection when the callback throws, and rethrows", async () => {
    try {
      await sqlconnector.withConnection(async () => {
        throw new Error("boom");
      });
      expect.fail("expected withConnection to rethrow");
    } catch (err) {
      expect(err.message).to.equal("boom");
    }

    expect(connection.released).to.equal(1);
  });
});

describe("SqlConnector.withTransaction", () => {
  const original = sqlconnector.getConnection;
  let connection;

  const useConnection = (c) => {
    connection = c;
    sqlconnector.getConnection = async () => c;
  };

  beforeEach(() => useConnection(txConnection()));
  afterEach(() => {
    sqlconnector.getConnection = original;
  });

  it("uses beginTransaction and commits by default", async () => {
    const result = await sqlconnector.withTransaction(async () => "done");

    expect(result).to.equal("done");
    expect(connection.calls).to.deep.equal(["BEGIN", "COMMIT"]);
    expect(connection.released).to.equal(1);
  });

  it("opens a READ ONLY transaction for mode readOnly", async () => {
    await sqlconnector.withTransaction(async () => null, { mode: "readOnly" });

    expect(connection.calls[0]).to.equal("START TRANSACTION READ ONLY");
  });

  it("opens a READ WRITE transaction for mode readWrite", async () => {
    await sqlconnector.withTransaction(async () => null, { mode: "readWrite" });

    expect(connection.calls[0]).to.equal("START TRANSACTION READ WRITE");
  });

  it("rolls back and rethrows when the body fails", async () => {
    try {
      await sqlconnector.withTransaction(async () => {
        throw new Error("body failed");
      });
      expect.fail("expected withTransaction to rethrow");
    } catch (err) {
      expect(err.message).to.equal("body failed");
    }

    expect(connection.calls).to.deep.equal(["BEGIN", "ROLLBACK"]);
    expect(connection.released).to.equal(1);
  });

  it("still reports the original error when the rollback itself fails", async () => {
    useConnection(txConnection({ failOn: "rollback" }));
    const originalLog = logger.log;
    const logged = [];
    logger.log = (level, message) => logged.push({ level, message });

    try {
      await sqlconnector.withTransaction(async () => {
        throw new Error("body failed");
      });
      expect.fail("expected withTransaction to rethrow");
    } catch (err) {
      // The body's error is what callers must see; the rollback failure is
      // reported separately rather than replacing it.
      expect(err.message).to.equal("body failed");
    } finally {
      logger.log = originalLog;
    }

    expect(connection.released).to.equal(1);
    expect(logged).to.have.lengthOf(1);
    expect(logged[0].level).to.equal(logger.appLogLevels.WARNING);
    expect(logged[0].message).to.match(/rollback failed: rollback failed/i);
  });
});
