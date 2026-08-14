import { expect } from "chai";
import express from "express";
import request from "supertest";

import bookingsRouter from "../../bookings/api.js";
import RESTError from "../../utils/RESTError.js";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => {
    res.locals.userauth = true;
    next();
  });
  app.use("/bookings", bookingsRouter);
  app.use((err, _req, res, _next) => {
    if (err instanceof RESTError) {
      res.status(err.status).json(err.payload);
      return;
    }

    res.status(err.status || 500).json(err.message || "Something went wrong");
  });

  return app;
}

describe("GET /bookings/session-rules", () => {
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
