const express = require('express');
const { validationResult, body, query } = require('express-validator')
const matchcontroller = require('./controller')
const { checkBookingPermissions, validatePatchRequest, validateBatchInsertRequest } = require('./middleware')
const { authGuard } = require('../middleware/clientauth')
const RESTError = require('./../utils/RESTError')
const pusher = require('./../pusher/Pusher')
const { log, appLogLevels } = require('./../utils/logger/logger');


const router = express.Router();

router.use(express.json())

/**
 * Route to get all bookings for a date
 */
router.get('/', authGuard, [
     query('date').isISO8601().toDate().withMessage('Date must be in ISO8601 format'),
],
     (req, res, next) => {

          const errors = validationResult(req);

          if (!errors.isEmpty()) {
               log(appLogLevels.ERROR, "Date error:" + JSON.stringify(errors.array()));
               return next(new RESTError(422, "Invalid date parameter"))
          }

          const date = req.query.date ? req.query.date : null

          matchcontroller.getBookingsForDate(date)
               .then((bookings) => {
                    res.json(bookings)
               })
               .catch((err) => {
                    next(err)
               })

     })

/**
 *  Route to get overlapping sesion for specific date and time
 */

router.get('/overlapping', authGuard, [
     query('date').isDate().withMessage("Invalid date"),
     query('start').matches(/^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$/, 'i').withMessage("Invalid start"),
     query('end').matches(/^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$/, 'i').withMessage("Invalid end"),
     query('court').isInt().withMessage("Invalid court")
],
     (req, res, next) => {

          const errors = validationResult(req);

          if (!errors.isEmpty()) {
               log(appLogLevels.ERROR, "Check Overlap parameter error: " + JSON.stringify(errors.array()));
               return next(new RESTError(422, "Invalid query parameter"))
          }

          const date = req.query.date ? req.query.date : null;
          const start = req.query.start ? req.query.start : null;
          const end = req.query.end ? req.query.end : null;
          const court = req.query.court ? req.query.court : null;

          matchcontroller.getOverlappingBookings(court, date, start, end)
               .then((bookings) => {
                    res.json(bookings);
               })
               .catch((err) => {
                    next(err)
               })

     }
);

router.get('/availability', authGuard, [
     query('date').isDate().withMessage("Invalid date"),
     query('start').matches(/^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$/, 'i').withMessage("Invalid start"),
     query('end').matches(/^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$/, 'i').withMessage("Invalid end"),
],
     (req, res, next) => {

          const errors = validationResult(req);

          if (!errors.isEmpty()) {
               log(appLogLevels.ERROR, "Court availability parameter error: " + JSON.stringify(errors.array()));
               return next(new RESTError(422, "Invalid query parameter"))
          }

          const date = req.query.date ? req.query.date : null;
          const start = req.query.start ? req.query.start : null;
          const end = req.query.end ? req.query.end : null;

          matchcontroller.getCourtAvailability(date, start, end)
               .then((availability) => {
                    res.json(availability);
               })
               .catch((err) => {
                    next(err)
               })

     }
);

router.post('/batch', validateBatchInsertRequest, (req, res, next) => {
     
     matchcontroller.addBookingBatch(req)
          .then(() => {
               pusher.trigger("bookings", "booking_change", {
                    date: req.body.date
               }).catch(err => {
                    log(appLogLevels.ERROR, `Pusher error in batch: ${err}`);
               })
               res.status(201).send()
          })
          .catch((err) => {
               next(err)
          })

});

router.post('/', [
     body('court').isInt().withMessage("Invalid court id"),
     body('bumpable').toInt().custom((val) => {
          return [0, 1].indexOf(val) === -1 ? false : true;
     }).withMessage("Value not allowed"),
     body('type').isInt().withMessage("Invalid booking type"),
     body('date').isDate().withMessage("Invalid date"),
     body('players').isArray({ min: 1, max: 4 }).withMessage("Incorrect number of players"),
     body('players.*.id').exists().withMessage("Player ID must be set").isInt().withMessage("Incorrect player ID"),
     body('players.*.type').exists().withMessage("Player TYPE must be set").isInt().withMessage("Incorrect player TYPE"),
     body('start').matches(/^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$/, 'i').withMessage("Invalid format"),
     body('end').matches(/^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$/, 'i').withMessage("Invalid format"),
     body('note').trim()

], authGuard, (req, res, next) => {

     const errors = validationResult(req);

     if (!errors.isEmpty()) {
          log(appLogLevels.ERROR, "Add booking validation error: " + JSON.stringify(errors.array()));
          return next(new RESTError(422, { fielderrors: errors.array({ onlyFirstError: true }) }));
     }

     matchcontroller.addBooking(req)
          .then(() => {

               pusher.trigger("bookings", "booking_change", {
                    date: req.body.date
               }).catch(err => {
                    log(appLogLevels.ERROR, `Pusher error in post: ${err}`);
               })
               res.status(201).send()

          })
          .catch((err) => {
               next(err)
          })



})

router.get('/:id', authGuard, (req, res, next) => {

     const id = req.params.id ? req.params.id : null;

     matchcontroller.getBookingData(id)
          .then((booking) => {
               res.locals.booking = booking;
               next()
          })
          .catch((err) => {
               next(err)
          });
},
     checkBookingPermissions,
     // eslint-disable-next-line no-unused-vars
     (req, res, next) => {
          //Fiter out values that are needed by the front end
          const filtered_booking = (({ start, end, permissions, booking_type_desc, date, court_id, court_name, bumpable, notes, id, etag, players, utc_start, utc_end, utc_req_time, type }) => {
               return {
                    'start': start,
                    'end': end,
                    'utc_start': utc_start,
                    'utc_end': utc_end,
                    'utc_req_time': utc_req_time,
                    'permissions': Array.from(permissions),
                    'type': type,
                    'booking_type_desc': booking_type_desc,
                    'date': date,
                    'court': court_id,
                    'court_name': court_name,
                    'bumpable': bumpable,
                    'notes': notes,
                    'id': id,
                    'etag': etag,
                    'players': players.map((player) => {
                         return {
                              'person_id': player.person_id,
                              'firstname': player.firstname,
                              'lastname': player.lastname,
                              'player_type_desc': player.player_type_desc
                         }
                    })
               }
          }
          )(res.locals.booking)

          res.json(filtered_booking);
     }
)

router.patch('/:id', authGuard, validatePatchRequest,
     (req, res, next) => {

          matchcontroller.processPatchCommand(req.params.id, res.locals.cmd)
               .then((result) => {

                    pusher.trigger("bookings", "booking_change", {
                         date: result
                    }).catch(err => {
                         log(appLogLevels.ERROR, `Pusher error in patch: ${err}`);
                    })

                    res.status(204).send()
               }).catch((err) => {

                    next(err)
               })

     })

module.exports = router
