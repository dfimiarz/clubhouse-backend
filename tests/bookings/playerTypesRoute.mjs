import { expect } from "chai";
import express from "express";
import request from "supertest";

import bookingsRouter from "../../bookings/api.js";
import bookingsController from "../../bookings/controller.js";
import RESTError from "../../utils/RESTError.js";

const originalSuggest = bookingsController.suggestPlayerTypesForToday;

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

describe("GET /bookings/player-types", () => {
  let receivedIds;

  beforeEach(() => {
    receivedIds = undefined;
    bookingsController.suggestPlayerTypesForToday = async (personIds) => {
      receivedIds = personIds;
      return {
        date: "2026-08-12",
        players: personIds.map((person_id) => ({
          person_id,
          player_type_id: 1000,
        })),
      };
    };
  });

  afterEach(() => {
    bookingsController.suggestPlayerTypesForToday = originalSuggest;
  });

  it("passes parsed person ids to the controller", async () => {
    const response = await request(createApp())
      .get("/bookings/player-types")
      .query({ person_ids: "1,2,3" });

    expect(response.status).to.equal(200);
    expect(receivedIds).to.deep.equal([1, 2, 3]);
    expect(response.body).to.deep.equal({
      date: "2026-08-12",
      players: [
        { person_id: 1, player_type_id: 1000 },
        { person_id: 2, player_type_id: 1000 },
        { person_id: 3, player_type_id: 1000 },
      ],
    });
  });

  it("rejects a missing person_ids query", async () => {
    const response = await request(createApp()).get("/bookings/player-types");
    expect(response.status).to.equal(422);
  });

  it("rejects more than 4 person_ids", async () => {
    const response = await request(createApp())
      .get("/bookings/player-types")
      .query({ person_ids: "1,2,3,4,5" });

    expect(response.status).to.equal(422);
  });

  it("rejects a non-integer person id", async () => {
    const response = await request(createApp())
      .get("/bookings/player-types")
      .query({ person_ids: "1,abc" });

    expect(response.status).to.equal(422);
  });

  it("rejects duplicate person_ids", async () => {
    const response = await request(createApp())
      .get("/bookings/player-types")
      .query({ person_ids: "7,7,7,7" });

    expect(response.status).to.equal(422);
    expect(receivedIds).to.equal(undefined);
  });

  it("rejects a repeated person id among distinct ones", async () => {
    const response = await request(createApp())
      .get("/bookings/player-types")
      .query({ person_ids: "1,2,1" });

    expect(response.status).to.equal(422);
    expect(receivedIds).to.equal(undefined);
  });

  it("rejects a zero person id", async () => {
    const response = await request(createApp())
      .get("/bookings/player-types")
      .query({ person_ids: "0" });

    expect(response.status).to.equal(422);
    expect(receivedIds).to.equal(undefined);
  });
});
