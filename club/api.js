const express = require('express');
const controller = require('./controller');
const { publicreadlimiter } = require('../rate-limiter/rate-limiter');

const router = express.Router();

router.use(express.json())

/**
 * Public club identity for the site shell. Unauthenticated on purpose:
 * branding, About, timezone, and calendar hours load before login.
 * Role capabilities and other internals are stripped by toPublicClub.
 */
router.get('/', publicreadlimiter, (req, res, next) => {

     controller.getClubInfo()
     .then((club)=>{
          res.json(controller.toPublicClub(club))
     })
     .catch((err) => {
          next(err)
     })

})

module.exports = router