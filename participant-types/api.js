const express = require("express");
const controller = require("./controller");
const { authGuard } = require("../middleware/clientauth");
const RESTError = require("../utils/RESTError");

const router = express.Router();

router.use(express.json());

router.get("/", authGuard, (_req, res, next) => {
  controller
    .getParticipantTypes()
    .then((types) => {
      res.json(types);
    })
    .catch((err) => {
      next(
        err instanceof RESTError
          ? err
          : new RESTError(500, "Failed loading participant types")
      );
    });
});

module.exports = router;
