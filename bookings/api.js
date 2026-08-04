const express = require('express');
const { z } = require('zod')
const { validate, hhmm, isoDate, intLike, requiredIntLike } = require('./../utils/validate')
const matchcontroller = require('./controller')
const { checkBookingPermissions, validatePatchRequest, validateBatchInsertRequest } = require('./middleware')
const { authGuard } = require('../middleware/clientauth')
const pusher = require('./../pusher/Pusher')
const { log, appLogLevels } = require('./../utils/logger/logger');


const router = express.Router();

router.use(express.json())

/**
 * Route to get all bookings for a date
 */
router.get('/', authGuard, validate(
     // Keep as YYYY-MM-DD string (do not coerce to Date) to avoid timezone day-shift in SQL
     { query: z.object({ date: isoDate('Invalid date') }) },
     { payload: () => "Invalid date parameter", logPrefix: "Date error" }
),
     (req, res, next) => {

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

router.get('/overlapping', authGuard, validate(
     {
          query: z.object({
               date: isoDate("Invalid date"),
               start: hhmm("Invalid start"),
               end: hhmm("Invalid end"),
               court: intLike("Invalid court")
          })
     },
     { payload: () => "Invalid query parameter", logPrefix: "Check Overlap parameter error" }
),
     (req, res, next) => {

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

router.get('/availability', authGuard, validate(
     {
          query: z.object({
               date: isoDate("Invalid date"),
               start: hhmm("Invalid start"),
               end: hhmm("Invalid end")
          })
     },
     { payload: () => "Invalid query parameter", logPrefix: "Court availability parameter error" }
),
     (req, res, next) => {

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

const newBookingBody = z.object({
     court: intLike("Invalid court id"),
     bumpable: z.union(
          [z.literal(0), z.literal(1), z.literal('0'), z.literal('1')],
          { error: "Value not allowed" }
     ).transform(Number),
     type: intLike("Invalid booking type"),
     date: isoDate("Invalid date"),
     players: z.array(
          z.object({
               id: requiredIntLike("Player ID must be set", "Incorrect player ID"),
               type: requiredIntLike("Player TYPE must be set", "Incorrect player TYPE")
          }),
          { error: "Incorrect number of players" }
     ).min(1, "Incorrect number of players").max(4, "Incorrect number of players"),
     start: hhmm("Invalid format"),
     end: hhmm("Invalid format"),
     //nullish, not optional: the client sends note: null when the field is blank
     note: z.string("Invalid note").trim().nullish()
})

router.post('/', authGuard, validate(
     { body: newBookingBody },
     { logPrefix: "Add booking validation error" }
), (req, res, next) => {

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
          const filtered_booking = (({ start, end, permissions, booking_type_desc, booking_type_lbl, calendar_style, member_rebookable, same_day_only, min_participant, date, court_id, court_name, bumpable, notes, id, etag, players, utc_start, utc_end, utc_req_time, type }) => {
               return {
                    'start': start,
                    'end': end,
                    'utc_start': utc_start,
                    'utc_end': utc_end,
                    'utc_req_time': utc_req_time,
                    'permissions': Array.from(permissions),
                    'type': type,
                    'booking_type_desc': booking_type_desc,
                    'booking_type_lbl': booking_type_lbl,
                    'calendar_style': calendar_style,
                    'member_rebookable': member_rebookable,
                    'same_day_only': same_day_only,
                    'min_participant': min_participant,
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
                              'player_type_desc': player.player_type_desc,
                              'club_role': player.club_role_public_label
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
