const express = require("express");

const router = express.Router();

router.use(express.json());

/**
 * Auth probes. Unauthenticated on purpose: the site boots these before
 * login so kiosk geo-auth and anonymous public mode can be distinguished.
 * They only echo the caller's own flags, not catalogs.
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
