import { expect } from "chai";

import sqlconnector from "../../db/SqlConnector.js";
import { readClubSettings } from "../../club/settingsReader.js";
import { DEFAULT_BUMPABILITY_POLICY } from "../../club/bumpabilityPolicy.js";

describe("readClubSettings", () => {
  const originalRunQuery = sqlconnector.runQuery;

  afterEach(() => {
    sqlconnector.runQuery = originalRunQuery;
  });

  it("reads every requested key in one query and applies defaults", async () => {
    const calls = [];
    sqlconnector.runQuery = async (_connection, query, values) => {
      calls.push({ query, values });
      return [{ setting_key: "prevent_concurrent_member_bookings", setting_value: "0" }];
    };

    const settings = await readClubSettings({}, [
      "prevent_concurrent_member_bookings",
      "bumpability_policy",
    ]);

    expect(calls).to.have.length(1);
    expect(calls[0].query).to.include("setting_key IN ?");
    expect(calls[0].values[1]).to.deep.equal([
      ["prevent_concurrent_member_bookings", "bumpability_policy"],
    ]);
    expect(settings).to.deep.equal({
      prevent_concurrent_member_bookings: false,
      bumpability_policy: DEFAULT_BUMPABILITY_POLICY,
    });
  });

  it("returns only the requested keys", async () => {
    sqlconnector.runQuery = async () => [];

    const settings = await readClubSettings({}, ["rebooking_prompt_enabled"]);

    expect(settings).to.deep.equal({ rebooking_prompt_enabled: false });
  });
});
