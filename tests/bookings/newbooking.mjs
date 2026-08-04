import { expect } from "chai";
import express from "express";
import request from "supertest";

import bookingsRouter from "../../bookings/api.js";
import bookingsController from "../../bookings/controller.js";
import RESTError from "../../utils/RESTError.js";

const originalAddBooking = bookingsController.addBooking;

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

function validBooking(overrides = {}) {
  return {
    court: 1,
    bumpable: 0,
    type: 1,
    date: "2026-08-04",
    start: "09:00",
    end: "10:00",
    note: "hello",
    players: [{ id: 1, type: 1 }],
    ...overrides,
  };
}

function post(body) {
  return request(createApp()).post("/bookings").send(body);
}

describe("New booking validation", () => {
  beforeEach(() => {
    bookingsController.addBooking = async () => {};
  });

  afterEach(() => {
    bookingsController.addBooking = originalAddBooking;
  });

  it("accepts a booking whose note is null", async () => {
    const response = await post(validBooking({ note: null }));

    expect(response.status).to.equal(201);
  });

  it("accepts a booking with no note at all", async () => {
    const body = validBooking();
    delete body.note;

    const response = await post(body);

    expect(response.status).to.equal(201);
  });

  it("rejects an empty string court instead of reading it as zero", async () => {
    const response = await post(validBooking({ court: "" }));

    expect(response.status).to.equal(422);
    expect(response.body.fielderrors).to.deep.include({
      param: "court",
      msg: "Invalid court id",
    });
  });

  it("rejects a null player id instead of reading it as zero", async () => {
    const response = await post(validBooking({ players: [{ id: null, type: 1 }] }));

    expect(response.status).to.equal(422);
    expect(response.body.fielderrors).to.deep.include({
      param: "players[0].id",
      msg: "Incorrect player ID",
    });
  });

  it("reports a missing player id separately from an invalid one", async () => {
    const response = await post(validBooking({ players: [{ type: 1 }] }));

    expect(response.status).to.equal(422);
    expect(response.body.fielderrors).to.deep.include({
      param: "players[0].id",
      msg: "Player ID must be set",
    });
  });

  it("accepts integers sent as strings", async () => {
    const response = await post(
      validBooking({ court: "2", type: "3", bumpable: "1", players: [{ id: "4", type: "5" }] })
    );

    expect(response.status).to.equal(201);
  });
});
