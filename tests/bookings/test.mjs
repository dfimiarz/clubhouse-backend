import { expect } from "chai";
import express from "express";
import request from "supertest";

import bookingsRouter from "../../bookings/api.js";
import errorHandler from "../../utils/errorHandler.js";
import RESTError from "../../utils/RESTError.js";

function createApp({ userauth = false } = {}) {
  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => {
    res.locals.userauth = userauth;
    res.locals.geoauth = false;
    next();
  });
  app.use("/bookings", bookingsRouter);
  app.use((_req, _res, next) => next(new RESTError(404, "Not Found")));
  app.use(errorHandler);

  return app;
}

describe("POST /bookings/batch", () => {
  it("is not an unauthenticated insert route", async () => {
    const response = await request(createApp())
      .post("/bookings/batch")
      .send([
        {
          date: "2024-01-01",
          start: "12:30:00",
          end: "13:30:00",
          court_id: 1,
          booking_type_id: 1,
          players: [{ person_id: 1, player_type_id: 1 }],
        },
      ]);

    expect(response.status).to.equal(404);
  });

  it("is not available to authenticated callers either", async () => {
    const response = await request(createApp({ userauth: true }))
      .post("/bookings/batch")
      .send([]);

    expect(response.status).to.equal(404);
  });
});
