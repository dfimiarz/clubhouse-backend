const rateLimit = require("express-rate-limit");
const utils = require("../utils/utils");

/**
 * IP-based limiters use req.ip. That follows X-Forwarded-For only when
 * TRUST_PROXY_MODE is not false (see server.js). Nginx must overwrite
 * X-Forwarded-For; do not pass the client copy through.
 *
 * Geo-auth continues to use socket.remoteAddress, not req.ip.
 *
 * Kiosk (geoauth) shares one LAN IP and polls the calendar, so it gets a
 * higher cap. Health checks and CORS preflight are not counted.
 */
function skipGlobalRateLimit(req) {
    if (req.method === "OPTIONS") {
        return true;
    }

    const path = req.path;
    return path === "/" || path === "/alive";
}

function isRateLimitedWrite(req) {
    const path = req.path;

    if (req.method === "POST" && (path === "/bookings" || path === "/bookings/" || path === "/guest_passes" || path === "/guest_passes/")) {
        return true;
    }

    if (req.method === "PATCH" && /^\/bookings\/[^/]+\/?$/.test(path)) {
        return true;
    }

    return false;
}

const APILimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: (_req, res) => (res.locals.geoauth === true ? 2000 : 200),
    standardHeaders: true,
    legacyHeaders: false,
    skip: skipGlobalRateLimit,
    message: "Too many requests. Please try again later.",
})

const writeLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: (_req, res) => (res.locals.geoauth === true ? 300 : 60),
    standardHeaders: true,
    legacyHeaders: false,
    message: "Too many write requests. Please try again later.",
})

const captchaLimiter = rateLimit({
    windowMs: 2 * 60 * 1000, // 2 minutes
    max: 20 // limit each IP to 100 requests per windowMs
})

const guestRegistrationLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: (req, res) => (utils.isAuthenticated(res) ? 20 : 5),
    standardHeaders: true,
    legacyHeaders: false,
    message: "Too many guest registration attempts. Please try again later."
})

const publicReadLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: "Too many public schedule requests. Please try again later."
})

const eventLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: "Too many analytics events. Please try again later."
})

module.exports = {
    apilimiter: APILimiter,
    writelimiter: writeLimiter,
    captchalimiter: captchaLimiter,
    guestregistrationlimiter: guestRegistrationLimiter,
    publicreadlimiter: publicReadLimiter,
    eventlimiter: eventLimiter,
    skipGlobalRateLimit,
    isRateLimitedWrite,
}
