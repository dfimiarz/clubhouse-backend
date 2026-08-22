const express = require('express')
const controller = require('./controller')
const { authGuard } = require('../middleware/clientauth')

const router = express.Router();

router.use(express.json());

router.get('/', authGuard, (req, res, next) => {

    controller.getBookingTypes()
        .then((booking_types) => {
            res.json(booking_types)
        })
        .catch((err) => {
            next(err)
        })

})

module.exports = router