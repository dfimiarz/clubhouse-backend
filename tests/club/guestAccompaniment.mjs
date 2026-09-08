import { expect } from "chai";
import express from "express";
import request from "supertest";
import sql from "../../db/SqlConnector.js";
import redis from "../../db/RedisConnector.js";
import clubRouter from "../../club/api.js";
import clubController from "../../club/controller.js";
import guestAccompaniment from "../../club/guestAccompanimentSettings.js";
import errorHandler from "../../utils/errorHandler.js";

const path = "/club/guest-accompaniment";
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

describe("guest accompaniment setting", () => {
  const originalConnection = sql.withConnection;
  const originalExecute = sql.runExecute;
  const originalDelete = redis.deleteKey;
  let stored;
  let writes;
  let deleted;

  beforeEach(() => {
    stored = null;
    writes = 0;
    deleted = [];
    sql.withConnection = async work => work({});
    sql.runExecute = async (_connection, query, values) => {
      expect(values[0]).to.equal(process.env.CLUB_ID);
      expect(values[1]).to.equal("require_guests_accompanied_by_member");
      if (query.startsWith("SELECT")) {
        return stored === null ? [] : [{ setting_key: values[1], setting_value: stored }];
      }
      expect(query).to.include("ON DUPLICATE KEY UPDATE");
      stored = values[2];
      writes += 1;
      return { affectedRows: 1 };
    };
    redis.deleteKey = async key => {
      expect(writes).to.be.greaterThan(0);
      deleted.push(key);
    };
  });

  afterEach(() => {
    sql.withConnection = originalConnection;
    sql.runExecute = originalExecute;
    redis.deleteKey = originalDelete;
  });

  it("defaults to requiring accompaniment and prevents caching the editor response", async () => {
    const response = await request(appFor()).get(path).expect(200);
    expect(response.headers["cache-control"]).to.equal("no-store");
    expect(response.body).to.deep.equal({ required: true, default: true });
  });

  it("persists both boolean values without invalidating the metadata cache", async () => {
    for (const required of [false, true]) {
      const response = await request(appFor()).put(path).send({ required }).expect(200);
      expect(response.body).to.deep.equal({ required, default: true });
      expect(stored).to.equal(required ? "1" : "0");
      expect((await request(appFor()).get(path)).body.required).to.equal(required);
    }
    expect(deleted).to.deep.equal([]);
  });

  it("rejects missing, coerced, and extra fields without writing or invalidating", async () => {
    for (const body of [{}, { required: "false" }, { required: 0 }, { required: null },
      { required: false, rebooking_prompt_enabled: true }]) {
      await request(appFor()).put(path).send(body).expect(422);
    }
    expect(writes).to.equal(0);
    expect(deleted).to.deep.equal([]);
  });

  it("requires authenticated administrator access for reads and writes", async () => {
    for (const app of [appFor(3000), appFor(4000, false)]) {
      await request(app).get(path).expect(401);
      await request(app).put(path).send({ required: false }).expect(401);
    }
    expect(writes).to.equal(0);
    expect(deleted).to.deep.equal([]);
  });

  it("does not invalidate the cache when the database write fails", async () => {
    sql.runExecute = async () => { throw new Error("Database unavailable"); };
    await request(appFor()).put(path).send({ required: false }).expect(500);
    expect(deleted).to.deep.equal([]);
    await request(appFor()).get(path).expect(500);
  });

  it("saves successfully when Redis is unavailable", async () => {
    redis.deleteKey = async () => { throw new Error("Cache unavailable"); };
    const response = await request(appFor()).put(path).send({ required: false }).expect(200);
    expect(response.body).to.deep.equal({ required: false, default: true });
    expect(stored).to.equal("0");
    expect(deleted).to.deep.equal([]);
  });
});

describe("fresh guest accompaniment in club info", () => {
  const key = "require_guests_accompanied_by_member";
  const client = redis.getClient();
  const originalGet = client.get;
  const originalSet = client.set;
  const originalConnection = sql.withConnection;
  const originalExecute = sql.runExecute;
  let cached;
  let stored;
  let reads;
  let pauseSettingsRead;

  beforeEach(() => {
    cached = {
      id: 1, name: "Test club",
      settings: { [key]: true, rebooking_prompt_enabled: true },
    };
    stored = "0";
    reads = [];
    pauseSettingsRead = async () => {};
    client.get = async cacheKey => {
      expect(cacheKey).to.equal(`club_info_${process.env.CLUB_ID}`);
      return cached === null ? null : JSON.stringify(cached);
    };
    client.set = async (cacheKey, payload) => {
      expect(cacheKey).to.equal(`club_info_${process.env.CLUB_ID}`);
      cached = JSON.parse(payload);
      return "OK";
    };
    sql.withConnection = async work => work({});
    sql.runExecute = async (_connection, query, values) => {
      if (query.startsWith("INSERT")) {
        stored = values[2];
        return { affectedRows: 1 };
      }
      reads.push(values);
      if (/FROM\s+club_setting/.test(query)) {
        expect(values[0]).to.equal(process.env.CLUB_ID);
        const snapshot = stored;
        if (values.length === 1) await pauseSettingsRead();
        else expect(values[1]).to.equal(key);
        return snapshot === null ? [] : [{ setting_key: key, setting_value: snapshot }];
      }
      if (/FROM\s+club\s/.test(query)) return [{ id: 1, name: "Test club" }];
      if (/FROM\s+role\s/.test(query)) return [{ id: 4000 }];
      return [];
    };
  });

  afterEach(() => {
    client.get = originalGet;
    client.set = originalSet;
    sql.withConnection = originalConnection;
    sql.runExecute = originalExecute;
  });

  it("overrides stale cached settings in both directions with one query per cache hit", async () => {
    for (const required of [false, true]) {
      stored = required ? "1" : "0";
      cached.settings[key] = !required;
      const result = await clubController.getClubInfo();
      expect(result.name).to.equal("Test club");
      expect(result.settings).to.deep.equal({ [key]: required, rebooking_prompt_enabled: true });
      expect(cached.settings[key]).to.equal(!required);
    }
    expect(reads).to.deep.equal([
      [process.env.CLUB_ID, key], [process.env.CLUB_ID, key],
    ]);
  });

  it("uses the database default when an override is removed, even with a cached false value", async () => {
    stored = null;
    cached.settings[key] = false;
    expect((await clubController.getClubInfo()).settings[key]).to.equal(true);
  });

  it("ignores an old cache fill that completes after a successful save", async () => {
    cached = null;
    stored = "1";
    let markRead;
    let releaseRead;
    const readStarted = new Promise(resolve => { markRead = resolve; });
    const readGate = new Promise(resolve => { releaseRead = resolve; });
    pauseSettingsRead = async () => {
      markRead();
      await readGate;
    };

    const pendingRead = clubController.getClubInfo();
    await readStarted;
    try {
      await guestAccompaniment.saveGuestAccompaniment(false);
    } finally {
      releaseRead();
    }
    expect((await pendingRead).settings[key]).to.equal(false);
    // The cache filled with the pre-save snapshot, but neither response uses it.
    expect(cached.settings[key]).to.equal(true);
    expect((await clubController.getClubInfo()).settings[key]).to.equal(false);
  });

  it("fails a request when the fresh setting cannot be read instead of serving the cached rule", async () => {
    sql.runExecute = async () => { throw new Error("Database unavailable"); };
    let failure;
    try {
      await clubController.getClubInfo();
    } catch (error) {
      failure = error;
    }
    expect(failure).to.be.an("error");
    expect(failure.message).to.equal("Database unavailable");
  });
});
