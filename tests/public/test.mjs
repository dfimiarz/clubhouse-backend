import { expect } from "chai";
import express from "express";
import request from "supertest";

import publicRouter from "../../public/api.js";
import publicController from "../../public/controller.js";
import bookingsRouter from "../../bookings/api.js";
import RESTError from "../../utils/RESTError.js";

const originalGetPublicCourts = publicController.getPublicCourts;
const originalGetPublicClubSchedules = publicController.getPublicClubSchedules;
const originalGetPublicBookingsForDate = publicController.getPublicBookingsForDate;

function createPublicApp() {
  const app = express();
  app.use(express.json());
  app.use("/public", publicRouter);
  app.use((err, _req, res, _next) => {
    if (err instanceof RESTError) {
      res.status(err.status).json(err.payload);
      return;
    }

    res.status(err.status || 500).json(err.message || "Something went wrong");
  });

  return app;
}

function createProtectedBookingsApp() {
  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => {
    res.locals.userauth = false;
    res.locals.geoauth = false;
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

describe("Public schedule API", () => {
  beforeEach(() => {
    publicController.getPublicCourts = async () => [
      { id: 1, name: "Court 1" },
      { id: 2, name: "Court 2" },
    ];
    publicController.getPublicClubSchedules = async () => [
      {
        id: 10,
        name: "Spring",
        from: "2026-01-01",
        from_ms: 1767243600,
        to: "2027-01-01",
        to_ms: 1798779600,
        default_start_min: 420,
        default_end_min: 1320,
        closed_time_frames: [],
        calTimes: [],
      },
    ];
    publicController.getPublicBookingsForDate = async (date) => {
      if (date !== "2026-04-27") {
        throw new RESTError(403, "Public schedule is only available for today");
      }

      return [
        {
          court: 1,
          date,
          start: "09:00:00",
          end: "09:45:00",
          start_min: 540,
          end_min: 585,
          status: "busy",
        },
      ];
    };
  });

  afterEach(() => {
    publicController.getPublicCourts = originalGetPublicCourts;
    publicController.getPublicClubSchedules = originalGetPublicClubSchedules;
    publicController.getPublicBookingsForDate = originalGetPublicBookingsForDate;
  });

  it("returns sanitized courts without authentication", async () => {
    const response = await request(createPublicApp()).get("/public/courts");

    expect(response.status).to.equal(200);
    expect(response.body).to.deep.equal([
      { id: 1, name: "Court 1" },
      { id: 2, name: "Court 2" },
    ]);
  });

  it("returns sanitized club schedule without private schedule items", async () => {
    const response = await request(createPublicApp()).get("/public/club_schedule");

    expect(response.status).to.equal(200);
    expect(response.body[0]).to.include({
      id: 10,
      name: "Spring",
      from: "2026-01-01",
      to: "2027-01-01",
    });
    expect(response.body[0]).to.not.have.property("club");
    expect(response.body[0]).to.not.have.property("open_time_frames");
    expect(JSON.stringify(response.body)).to.not.include("message");
  });

  it("returns sanitized today bookings without private fields", async () => {
    const response = await request(createPublicApp())
      .get("/public/bookings")
      .query({ date: "2026-04-27" });

    expect(response.status).to.equal(200);
    expect(response.body).to.deep.equal([
      {
        court: 1,
        date: "2026-04-27",
        start: "09:00:00",
        end: "09:45:00",
        start_min: 540,
        end_min: 585,
        status: "busy",
      },
    ]);

    const serialized = JSON.stringify(response.body);
    expect(serialized).to.not.include("players");
    expect(serialized).to.not.include("notes");
    expect(serialized).to.not.include("booking_type");
    expect(serialized).to.not.include("bumpable");
    expect(serialized).to.not.include("etag");
  });

  it("rejects invalid public booking dates", async () => {
    const response = await request(createPublicApp())
      .get("/public/bookings")
      .query({ date: "2026" });

    expect(response.status).to.equal(422);
  });

  it("rejects non-today public booking dates", async () => {
    const response = await request(createPublicApp())
      .get("/public/bookings")
      .query({ date: "2026-04-28" });

    expect(response.status).to.equal(403);
  });

  it("keeps existing booking list protected", async () => {
    const response = await request(createProtectedBookingsApp())
      .get("/bookings")
      .query({ date: "2026-04-27" });

    expect(response.status).to.equal(401);
  });
});
