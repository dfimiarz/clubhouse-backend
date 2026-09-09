const express = require("express");
const controller = require("./controller");
const { authGuard, roleGuard } = require("../middleware/clientauth");
const { ROLES } = require("../utils/dbconstants");
const { validate } = require("../utils/validate");
const { passTypeSchema, passTypeParams } = require("./validation");
const RESTError = require("./../utils/RESTError");

/**
 * @typedef {import("./types").PassType} PassType;
 */

const router = express.Router();

router.use(express.json());

router.get("/", authGuard, (_req, res, next) => {
  controller
    .getPassTypes()
    .then((result) => {
      res.set("Cache-Control", "no-store").json(result);
    })
    .catch((err) => {
      next(err instanceof RESTError ? err : new RESTError(500, "Operation failed"));
    });
});

router.post("/", authGuard, roleGuard(ROLES.ADMIN),
  validate({ body: passTypeSchema }), async (req, res, next) => {
    try {
      res.status(201).json(await controller.savePassType(null, req.body));
    } catch (err) {
      next(err);
    }
  });

router.put("/:id", authGuard, roleGuard(ROLES.ADMIN),
  validate({ params: passTypeParams, body: passTypeSchema }), async (req, res, next) => {
    try {
      res.json(await controller.savePassType(req.params.id, req.body));
    } catch (err) {
      next(err);
    }
  });

module.exports = router;
