const express = require("express");
const { z } = require("zod");
const { validate, isoDate } = require("../utils/validate");
const controller = require("./controller");
const { publicreadlimiter } = require("../rate-limiter/rate-limiter");

const router = express.Router();

router.use(express.json());
router.use(publicreadlimiter);

router.get("/courts", (_req, res, next) => {
  controller
    .getPublicCourts()
    .then((courts) => {
      res.json(courts);
    })
    .catch((err) => {
      next(err);
    });
});

router.get("/club_schedule", (_req, res, next) => {
  controller
    .getPublicClubSchedules()
    .then((schedules) => {
      res.json(schedules);
    })
    .catch((err) => {
      next(err);
    });
});

router.get(
  "/bookings",
  validate(
    { query: z.object({ date: isoDate("Date must be in YYYY-MM-DD format") }) },
    {
      status: 422,
      payload: () => "Invalid date parameter",
      logPrefix: "Public booking date error",
    }
  ),
  (req, res, next) => {
    controller
      .getPublicBookingsForDate(req.query.date)
      .then((bookings) => {
        res.json(bookings);
      })
      .catch((err) => {
        next(err);
      });
  }
);

module.exports = router;
