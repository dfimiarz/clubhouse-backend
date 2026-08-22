import { expect } from "chai";
import express from "express";
import request from "supertest";

import publicRouter from "../../public/api.js";
import publicController from "../../public/controller.js";
import bookingsRouter from "../../bookings/api.js";
import errorHandler from "../../utils/errorHandler.js";
import RESTError from "../../utils/RESTError.js";

const originalGetPublicCourts = publicController.getPublicCourts;
const originalGetPublicClubSchedules = publicController.getPublicClubSchedules;
const originalGetPublicBookingsForDate = publicController.getPublicBookingsForDate;

function createPublicApp() {
  const app = express();
  app.use(express.json());
  app.use("/public", publicRouter);
  app.use(errorHandler);

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
  app.use(errorHandler);

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
          booking_type_desc: "Match",
          calendar_style: "match",
          utility: 1,
        },
        {
          court: 2,
          date,
          start: "10:00:00",
          end: "12:00:00",
          start_min: 600,
          end_min: 720,
          status: "busy",
          booking_type_desc: "Rain Break",
          calendar_style: "event",
          utility: 0,
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
        booking_type_desc: "Match",
        calendar_style: "match",
        utility: 1,
      },
      {
        court: 2,
        date: "2026-04-27",
        start: "10:00:00",
        end: "12:00:00",
        start_min: 600,
        end_min: 720,
        status: "busy",
        booking_type_desc: "Rain Break",
        calendar_style: "event",
        utility: 0,
      },
    ]);

    for (const booking of response.body) {
      assertNoPrivatePublicBookingFields(booking);
    }
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

const PRIVATE_PUBLIC_BOOKING_KEYS = [
  "players",
  "notes",
  "id",
  "type",
  "group_id",
  "bumpable",
  "etag",
];

function occupancyRow(overrides = {}) {
  return {
    court: 1,
    date: "2026-04-27",
    start: "09:00:00",
    end: "09:45:00",
    start_min: 540,
    end_min: 585,
    ...overrides,
  };
}

function assertNoPrivatePublicBookingFields(booking) {
  for (const key of PRIVATE_PUBLIC_BOOKING_KEYS) {
    expect(booking).to.not.have.property(key);
  }
}

describe("toPublicBooking", () => {
  it("adds catalog label, calendar style, and utility for any session", () => {
    const cases = [
      { desc: "Match", calendar_style: "match", utility: 1 },
      { desc: "Lesson", calendar_style: "lesson", utility: 1 },
      { desc: "Club Event", calendar_style: "event", utility: 1 },
      { desc: "Maintenance", calendar_style: "event", utility: 0 },
      { desc: "Rain Break", calendar_style: "event", utility: 0 },
    ];

    for (const { desc, calendar_style, utility } of cases) {
      const booking = publicController.toPublicBooking(
        occupancyRow({
          booking_type_desc: desc,
          calendar_style,
          utility,
        })
      );
      expect(booking).to.include({
        booking_type_desc: desc,
        calendar_style,
        utility,
        status: "busy",
      });
      assertNoPrivatePublicBookingFields(booking);
    }
  });

  it("prefers catalog lbl and falls back to desc", () => {
    const labeled = publicController.toPublicBooking(
      occupancyRow({
        booking_type_desc: "Match",
        booking_type_lbl: "MATCH",
        calendar_style: "match",
        utility: 1,
      })
    );
    expect(labeled.booking_type_desc).to.equal("MATCH");

    const fallback = publicController.toPublicBooking(
      occupancyRow({
        booking_type_desc: "Match",
        booking_type_lbl: "  ",
        calendar_style: "match",
        utility: 1,
      })
    );
    expect(fallback.booking_type_desc).to.equal("Match");
    assertNoPrivatePublicBookingFields(labeled);
    assertNoPrivatePublicBookingFields(fallback);
  });

  it("omits the label when desc and lbl are blank", () => {
    const booking = publicController.toPublicBooking(
      occupancyRow({ booking_type_desc: "  ", booking_type_lbl: "  " })
    );
    expect(booking).to.not.have.property("booking_type_desc");
    assertNoPrivatePublicBookingFields(booking);
  });
});
