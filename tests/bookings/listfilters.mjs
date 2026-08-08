import { expect } from "chai";
import express from "express";
import request from "supertest";

import bookingsRouter from "../../bookings/api.js";
import bookingsController from "../../bookings/controller.js";
import RESTError from "../../utils/RESTError.js";

const { buildBookingListFilters, getBookingsForDate: originalGetBookingsForDate } =
  bookingsController;

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

describe("buildBookingListFilters", () => {
  it("keeps a single-day date predicate without an ended window", () => {
    const result = buildBookingListFilters("2026-08-07", { rebookable: true });

    expect(result.datePredicate).to.equal("date = ?");
    expect(result.dateParams).to.deep.equal(["2026-08-07"]);
    expect(result.filterPredicates.some((p) => p.includes("member_rebookable"))).to
      .be.true;
  });

  it("uses full club-local datetimes for ended bounds", () => {
    const result = buildBookingListFilters("2026-08-07", {
      endedMinAgo: 5,
      endedMaxAgo: 20,
    });

    const joined = result.filterPredicates.join("\n");
    expect(joined).to.include("TIMESTAMP(activity.date, activity.end)");
    expect(joined).to.include("INTERVAL ? MINUTE");
    expect(joined).to.not.include("TIME_TO_SEC");
    expect(result.filterParams).to.deep.equal([20, 5]);
  });

  it("honors endedMinAgo of zero", () => {
    const result = buildBookingListFilters("2026-08-07", {
      endedMinAgo: 0,
      endedMaxAgo: 20,
    });

    expect(result.filterParams).to.deep.equal([20, 0]);
    expect(result.filterPredicates).to.have.length(2);
  });

  it("widens date to previous day when an ended window is set", () => {
    const result = buildBookingListFilters("2026-08-07", {
      endedMaxAgo: 20,
    });

    expect(result.datePredicate).to.equal(
      "date BETWEEN DATE_SUB(?, INTERVAL 1 DAY) AND ?"
    );
    expect(result.dateParams).to.deep.equal(["2026-08-07", "2026-08-07"]);
  });

  it("adds person_ids EXISTS filter with array bind", () => {
    const result = buildBookingListFilters("2026-08-07", {
      personIds: [1, 2, 3],
    });

    expect(result.filterPredicates.join(" ")).to.include("fp.person IN ( ? )");
    expect(result.filterParams).to.deep.equal([[1, 2, 3]]);
  });
});

describe("GET /bookings list filter validation", () => {
  beforeEach(() => {
    bookingsController.getBookingsForDate = async () => [];
  });

  afterEach(() => {
    bookingsController.getBookingsForDate = originalGetBookingsForDate;
  });

  it("accepts rebooking window query params including ended_min_ago=0", async () => {
    const response = await request(createApp())
      .get("/bookings")
      .query({
        date: "2026-08-07",
        rebookable: "1",
        ended_min_ago: "0",
        ended_max_ago: "20",
        person_ids: "1,2",
      });

    expect(response.status).to.equal(200);
  });

  it("rejects ended_min_ago >= ended_max_ago", async () => {
    const response = await request(createApp())
      .get("/bookings")
      .query({
        date: "2026-08-07",
        ended_min_ago: "20",
        ended_max_ago: "5",
      });

    expect(response.status).to.equal(422);
  });

  it("rejects more than 20 person_ids", async () => {
    const ids = Array.from({ length: 21 }, (_, i) => i + 1).join(",");
    const response = await request(createApp())
      .get("/bookings")
      .query({
        date: "2026-08-07",
        person_ids: ids,
      });

    expect(response.status).to.equal(422);
  });
});
