import { expect } from "chai";
import express from "express";
import request from "supertest";

import bookingsRouter from "../../bookings/api.js";
import bookingsController from "../../bookings/controller.js";
import errorHandler from "../../utils/errorHandler.js";

const originalAddBooking = bookingsController.addBooking;
const originalCheckNewBooking = bookingsController.checkNewBooking;

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

  it("accepts a note of 256 characters", async () => {
    const response = await post(validBooking({ note: "x".repeat(256) }));

    expect(response.status).to.equal(201);
  });

  it("accepts a 257-character note that trims to 256", async () => {
    const response = await post(validBooking({ note: `${"x".repeat(256)} ` }));

    expect(response.status).to.equal(201);
  });

  it("rejects a note longer than 256 characters", async () => {
    const response = await post(validBooking({ note: "x".repeat(257) }));

    expect(response.status).to.equal(422);
    expect(response.body.fielderrors).to.deep.include({
      param: "note",
      msg: "Note too long",
    });
  });
});

describe("POST /bookings/validate", () => {
  let checked;

  beforeEach(() => {
    checked = null;
    bookingsController.addBooking = async () => {
      throw new Error("validate must not create a booking");
    };
    bookingsController.checkNewBooking = async (req) => {
      checked = req.body;
    };
  });

  afterEach(() => {
    bookingsController.addBooking = originalAddBooking;
    bookingsController.checkNewBooking = originalCheckNewBooking;
  });

  function validateRequest(body) {
    return request(createApp()).post("/bookings/validate").send(body);
  }

  it("returns 204 when the booking would be accepted", async () => {
    const response = await validateRequest(validBooking());

    expect(response.status).to.equal(204);
    expect(checked).to.include({ court: 1, date: "2026-08-04" });
  });

  it("uses the create schema", async () => {
    const response = await validateRequest(validBooking({ players: [] }));

    expect(response.status).to.equal(422);
    expect(checked).to.equal(null);
  });

  it("returns the create error unchanged", async () => {
    const { default: RESTError } = await import("../../utils/RESTError.js");
    bookingsController.checkNewBooking = async () => {
      throw new RESTError(422, "Booking overlap found.");
    };

    const response = await validateRequest(validBooking());

    expect(response.status).to.equal(422);
    expect(response.body).to.equal("Booking overlap found.");
  });
});
