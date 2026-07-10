const rateLimit = require("express-rate-limit");
const utils = require("../utils/utils");

let APILimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 200 // limit each IP to 200 requests per windowMs
})

let guestRegistrationLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: (req, res) => (utils.isAuthenticated(res) ? 20 : 5),
    standardHeaders: true,
    legacyHeaders: false,
    message: "Too many guest registration attempts. Please try again later."
})

let publicReadLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: "Too many public schedule requests. Please try again later."
})

module.exports = {
    apilimiter: APILimiter,
    guestregistrationlimiter: guestRegistrationLimiter,
    publicreadlimiter: publicReadLimiter
}
