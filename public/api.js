const express = require("express");
const { query, validationResult } = require("express-validator");
const controller = require("./controller");
const RESTError = require("../utils/RESTError");
const { publicreadlimiter } = require("../rate-limiter/rate-limiter");
const { log, appLogLevels } = require("../utils/logger/logger");

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
  [
    query("date")
      .matches(/^\d{4}-\d{2}-\d{2}$/)
      .withMessage("Date must be in YYYY-MM-DD format")
      .bail()
      .isISO8601({ strict: true, strictSeparator: true })
      .withMessage("Date must be in ISO8601 format"),
  ],
  (req, res, next) => {
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      log(appLogLevels.ERROR, `Public booking date error: ${JSON.stringify(errors.array())}`);
      return next(new RESTError(422, "Invalid date parameter"));
    }

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
