const express = require("express");
const authcontroller = require("./controller");

const router = express.Router();

router.use(express.json());

/**
 * Route to check for geoauth
 */
router.get("/geo", (req, res, _next) => {
  res.json({ geoauth: res.locals.geoauth });
});

router.get("/user/profile", (req, res, _next) => {
  res.json({
    role: res.locals.role ? res.locals.role : null,
    geoauth: res.locals.geoauth,
  });
});

module.exports = router;
