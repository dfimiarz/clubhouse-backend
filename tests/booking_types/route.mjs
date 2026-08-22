import { expect } from "chai";
import express from "express";
import request from "supertest";

import bookingTypesRouter from "../../booking_types/api.js";
import bookingTypesController from "../../booking_types/controller.js";
import errorHandler from "../../utils/errorHandler.js";

const originalGetBookingTypes = bookingTypesController.getBookingTypes;

function createApp({ userauth = true } = {}) {
  const app = express();
  app.use((_req, res, next) => {
    res.locals.userauth = userauth;
    next();
  });
  app.use("/booking_types", bookingTypesRouter);
  app.use(errorHandler);

  return app;
}

describe("GET /booking_types", () => {
  afterEach(() => {
    bookingTypesController.getBookingTypes = originalGetBookingTypes;
  });

  it("rejects unauthenticated requests", async () => {
    const response = await request(createApp({ userauth: false })).get(
      "/booking_types"
    );

    expect(response.status).to.equal(401);
  });

  it("returns the catalog when authenticated", async () => {
    bookingTypesController.getBookingTypes = async () => [
      {
        id: 1000,
        lbl: "MATCH",
        restricted: 0,
        member_rebookable: 1,
        same_day_only: 0,
      },
    ];

    const response = await request(createApp()).get("/booking_types");

    expect(response.status).to.equal(200);
    expect(response.body).to.deep.equal([
      {
        id: 1000,
        lbl: "MATCH",
        restricted: 0,
        member_rebookable: 1,
        same_day_only: 0,
      },
    ]);
  });

  it("wraps unexpected controller errors", async () => {
    bookingTypesController.getBookingTypes = async () => {
      throw new Error("ER_NO_SUCH_TABLE: activity_type");
    };

    const response = await request(createApp()).get("/booking_types");

    expect(response.status).to.equal(500);
    expect(response.body).to.deep.equal({ errors: "Something went wrong" });
  });
});
