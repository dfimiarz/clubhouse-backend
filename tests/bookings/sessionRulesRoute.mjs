import { expect } from "chai";
import express from "express";
import request from "supertest";

import bookingsRouter from "../../bookings/api.js";
import errorHandler from "../../utils/errorHandler.js";
import settingsReader from "../../club/settingsReader.js";
import { DEFAULT_SESSION_DURATION_POLICY } from "../../club/sessionDurationPolicy.js";
import { DEFAULT_BUMPABILITY_POLICY } from "../../club/bumpabilityPolicy.js";

const originalReadClubSettings = settingsReader.readClubSettings;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => {
    res.locals.userauth = true;
    next();
  });
  app.use("/bookings", bookingsRouter);
  app.use(errorHandler);

  return app;
}

describe("GET /bookings/session-rules", () => {
  let sessionPolicy;
  let bumpabilityPolicy;
  let reads;

  beforeEach(() => {
    sessionPolicy = DEFAULT_SESSION_DURATION_POLICY;
    bumpabilityPolicy = DEFAULT_BUMPABILITY_POLICY;
    reads = [];
    settingsReader.readClubSettings = async (connection, keys) => {
      reads.push(keys);
      return {
        session_duration_policy: sessionPolicy,
        bumpability_policy: bumpabilityPolicy,
      };
    };
  });
  afterEach(() => {
    settingsReader.readClubSettings = originalReadClubSettings;
  });

  it("uses the current club policy and prevents response caching", async () => {
    const policy = structuredClone(DEFAULT_SESSION_DURATION_POLICY);
    policy[2].full_duration_min = 75;
    policy[2].full_allotment.min_non_repeaters = 1;
    sessionPolicy = policy;
    const response = await request(createApp()).get('/bookings/session-rules')
      .query({ player_types: '1000,2000' });
    expect(response.status).to.equal(200);
    expect(response.body.max_duration_min).to.equal(75);
    expect(response.headers['cache-control']).to.equal('no-store');
    expect(reads).to.deep.equal([['session_duration_policy', 'bumpability_policy']]);
  });

  it("propagates settings read failures", async () => {
    settingsReader.readClubSettings = async () => { throw new Error('Unavailable'); };
    const response = await request(createApp()).get('/bookings/session-rules')
      .query({ player_types: '1000' });
    expect(response.status).to.equal(500);
  });
  it("returns duration and bumpable for a valid lineup", async () => {
    const response = await request(createApp())
      .get("/bookings/session-rules")
      .query({ player_types: "1000,1000" });

    expect(response.status).to.equal(200);
    expect(response.body).to.deep.equal({
      player_types: [1000, 1000],
      player_count: 2,
      max_duration_min: 60,
      bumpable: false,
    });
  });

  it("marks a lineup with a second repeater bumpable", async () => {
    const response = await request(createApp())
      .get("/bookings/session-rules")
      .query({ player_types: "1000,3000" });

    expect(response.status).to.equal(200);
    expect(response.body.max_duration_min).to.equal(30);
    expect(response.body.bumpable).to.equal(true);
  });

  it("uses the current club bumpability policy", async () => {
    bumpabilityPolicy = "any_repeater";
    const response = await request(createApp())
      .get("/bookings/session-rules")
      .query({ player_types: "1000,2000" });

    expect(response.status).to.equal(200);
    expect(response.body.bumpable).to.equal(true);
  });

  it("rejects a missing player_types query", async () => {
    const response = await request(createApp()).get("/bookings/session-rules");
    expect(response.status).to.equal(422);
  });

  it("rejects more than 4 player types", async () => {
    const response = await request(createApp())
      .get("/bookings/session-rules")
      .query({ player_types: "1000,1000,1000,1000,1000" });

    expect(response.status).to.equal(422);
  });

  it("rejects a non-integer player type", async () => {
    const response = await request(createApp())
      .get("/bookings/session-rules")
      .query({ player_types: "1000,abc" });

    expect(response.status).to.equal(422);
  });

  it("rejects an unknown player type", async () => {
    const response = await request(createApp())
      .get("/bookings/session-rules")
      .query({ player_types: "4000" });

    expect(response.status).to.equal(422);
  });

  it("rejects a zero player type", async () => {
    const response = await request(createApp())
      .get("/bookings/session-rules")
      .query({ player_types: "0" });

    expect(response.status).to.equal(422);
  });
});
