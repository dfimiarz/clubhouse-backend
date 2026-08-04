const express = require("express");
const controller = require("./controller");
const { authGuard } = require("../middleware/clientauth");
const { z } = require("zod");
const { validate, intLike } = require("./../utils/validate");

const router = express.Router();

router.use(express.json());

router.post(
  "/",
  authGuard,
  validate(
    {
      body: z.object({
        guest: intLike("Invalid guest id"),
        host: intLike("Invalid host id"),
        pass_type: intLike("Invalid pass type"),
      }),
    },
    { logPrefix: "Guest pass activation error" }
  ),
  (req, res, next) => {
    //Get guest, host and pass type from request body
    const { guest, host, pass_type } = req.body;

    //Insert a new guest pass
    controller
      .addGuestPass({ guest, host, pass_type })
      .then((result) => {
        res.json(result);
      })
      .catch((err) => {
        next(err);
      });
  }
);

module.exports = router;
