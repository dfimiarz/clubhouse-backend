import { expect } from "chai";
import express from "express";
import request from "supertest";
import sql from "../../db/SqlConnector.js";
import clubRouter from "../../club/api.js";
import errorHandler from "../../utils/errorHandler.js";
import settingsModule from "../../club/settings.js";
import bumpability from "../../club/bumpabilityPolicy.js";

const { resolveSettings } = settingsModule;
const { DEFAULT_BUMPABILITY_POLICY } = bumpability;

function appFor(role = 4000, userauth = true) {
  const app = express();
  app.use((_req, res, next) => {
    Object.assign(res.locals, { role, userauth });
    next();
  });
  app.use("/club", clubRouter);
  app.use(errorHandler);
  return app;
}

describe("bumpability policy", () => {
  const originalConnection = sql.withConnection;
  const originalExecute = sql.runExecute;
  let stored;
  let writes;

  beforeEach(() => {
    stored = null;
    writes = 0;
    sql.withConnection = async work => work({});
    sql.runExecute = async (_connection, query, values) => {
      expect(values[0]).to.equal(process.env.CLUB_ID);
      expect(values[1]).to.equal("bumpability_policy");
      if (query.startsWith("SELECT")) {
        return stored === null ? [] : [{ setting_key: values[1], setting_value: stored }];
      }
      expect(query).to.include("ON DUPLICATE KEY UPDATE");
      stored = values[2];
      writes += 1;
      return { affectedRows: 1 };
    };
  });

  afterEach(() => {
    sql.withConnection = originalConnection;
    sql.runExecute = originalExecute;
  });

  it("preserves the existing second-repeater rule as the default", async () => {
    expect(DEFAULT_BUMPABILITY_POLICY).to.equal("second_repeater");
    const response = await request(appFor()).get("/club/bumpability-policy");
    expect(response.status).to.equal(200);
    expect(response.headers["cache-control"]).to.equal("no-store");
    expect(response.body).to.deep.equal({
      policy: "second_repeater",
      default: "second_repeater",
    });
  });

  it("persists a policy and returns it on the next read", async () => {
    const saved = await request(appFor())
      .put("/club/bumpability-policy")
      .send({ policy: "any_repeater" });
    expect(saved.status).to.equal(200);
    expect(saved.body.policy).to.equal("any_repeater");
    expect(writes).to.equal(1);
    expect((await request(appFor()).get("/club/bumpability-policy")).body.policy)
      .to.equal("any_repeater");
  });

  it("rejects unknown policies before writing", async () => {
    await request(appFor())
      .put("/club/bumpability-policy")
      .send({ policy: "sometimes" })
      .expect(422);
    expect(writes).to.equal(0);
  });

  it("requires administrator access", async () => {
    await request(appFor(3000)).get("/club/bumpability-policy").expect(401);
    await request(appFor(3000))
      .put("/club/bumpability-policy")
      .send({ policy: "always" })
      .expect(401);
    expect(writes).to.equal(0);
  });

  it("falls back safely when a stored value is not recognized", () => {
    expect(resolveSettings([
      { setting_key: "bumpability_policy", setting_value: "sometimes" },
    ], { publicOnly: false }).bumpability_policy).to.equal("second_repeater");
  });
});
