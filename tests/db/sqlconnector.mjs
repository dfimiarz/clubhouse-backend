import { expect } from "chai";

import sqlconnector from "../../db/SqlConnector.js";

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
