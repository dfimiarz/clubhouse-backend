"use strict";

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const compression = require("compression");
const app = express();
const RESTError = require("./utils/RESTError");
const errorHandler = require("./utils/errorHandler");
const {
  checkUserAuth,
  checkGeoAuth,
  checkUserRole,
} = require("./middleware/clientauth");
const { getAllowedOrigins } = require("./utils/corsOrigins");
const {
  apilimiter,
  writelimiter,
  isRateLimitedWrite,
} = require("./rate-limiter/rate-limiter");
const { log, appLogLevels } = require('./utils/logger/logger');

app.set("trust proxy", getTrustedProxySetting());

const allowedHosts = getAllowedOrigins();

console.log("Permitted client", allowedHosts);

const corsOptions = {
  origin: allowedHosts,
  optionsSuccessStatus: 200,
  credentials: true,
  exposedHeaders: ["Etag"],
};

app.use(compression());
app.use(cors(corsOptions));

// Geo-auth first so the IP limiters can raise the cap for kiosks. Limiters
// run before Firebase token verification. req.ip follows X-Forwarded-For
// only when TRUST_PROXY_MODE is not false; nginx must overwrite that header.
app.use(checkGeoAuth);
app.use(apilimiter);
app.use((req, res, next) => {
  if (isRateLimitedWrite(req)) {
    return writelimiter(req, res, next);
  }
  next();
});
app.use(checkUserAuth, checkUserRole);

app.get("/", (_req, res) => {
  res.json({
    name: "Knicks-Tennis API",
    version: "1.0",
  });
});
app.use("/alive", (_req, res, _next) => {
  res.status(200).json({ status: "ok" });
});

app.use("/public", require("./public/api"));
app.use("/courts", require("./courts/api"));
app.use("/bookings", require("./bookings/api"));
app.use("/persons", require("./persons/api"));
app.use("/auth", require("./auth/api"));
app.use("/booking_types", require("./booking_types/api"));
app.use("/participant-types", require("./participant-types/api"));
app.use("/club_schedule", require("./club_schedule/api.js"));
app.use("/club", require("./club/api"));
app.use("/reports", require("./reports/api"));
app.use("/activities", require("./activities/api"));
app.use("/guest_passes", require("./guest_passes/api"));
app.use("/guest-pass-types", require("./guest-pass-types/api"));
app.use("/payment-types", require("./payment-types/api"));
app.use("/events", require("./analytics/api"));

app.use((_req, _res, next) => {
  next(new RESTError(404, "Not Found"));
});

app.use(errorHandler);

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}...`);
  console.log(`Press Ctrl+C to quit`);
});

function getTrustedProxySetting() {
  const mode = (process.env.TRUST_PROXY_MODE || "false").trim().toLowerCase();

  if (mode === "true") {
    return true;
  }

  if (mode === "false") {
    return false;
  }

  if (mode === "loopback") {
    return "loopback";
  }

  if (mode === "private") {
    return ["loopback", "linklocal", "uniquelocal"];
  }

  if (mode === "cidr") {
    return (process.env.TRUST_PROXY_CIDRS || "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  log(appLogLevels.ERROR, `Invalid TRUST_PROXY_MODE "${process.env.TRUST_PROXY_MODE}". Falling back to false.`);
  return false;
}

module.exports = app;
