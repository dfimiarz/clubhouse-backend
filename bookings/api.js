const express = require('express');
const { z } = require('zod')
const { validate, hhmm, isoDate, intLike, requiredIntLike, csvIntList } = require('./../utils/validate')
const matchcontroller = require('./controller')
const { resolveSessionRules, MATCH_PLAYER_TYPE_IDS } = require('./sessionRules')
const { checkBookingPermissions, validatePatchRequest, validateBatchInsertRequest } = require('./middleware')
const { authGuard } = require('../middleware/clientauth')
const pusher = require('./../pusher/Pusher')
const { log, appLogLevels } = require('./../utils/logger/logger');
const RESTError = require('./../utils/RESTError')


const router = express.Router();

router.use(express.json())

/**
 * Route to get all bookings for a date
 */
router.get('/', authGuard, validate(
     // Keep as YYYY-MM-DD string (do not coerce to Date) to avoid timezone day-shift in SQL
     {
          query: z.object({
               date: isoDate('Invalid date'),
               rebookable: z.literal('1', 'Invalid rebookable').optional(),
               ended_min_ago: intLike('Invalid ended_min_ago').pipe(z.number().min(0).max(120)).optional(),
               ended_max_ago: intLike('Invalid ended_max_ago').pipe(z.number().min(1).max(120)).optional(),
               // Cap list size: match booking allows ≤4 players; leave headroom for admin tools
               person_ids: csvIntList({
                    message: 'Invalid person_ids',
                    max: 20,
                    maxMessage: 'Too many person_ids',
                    item: (n) => Number.isSafeInteger(n) && n > 0,
                    itemMessage: 'Invalid person_ids',
               }).optional()
          }).refine(
               (query) => query.ended_min_ago === undefined
                    || query.ended_max_ago === undefined
                    || query.ended_min_ago < query.ended_max_ago,
               { error: 'ended_min_ago must be less than ended_max_ago', path: ['ended_min_ago'] }
          )
     },
     { payload: () => "Invalid query parameter", logPrefix: "Get bookings parameter error" }
),
     (req, res, next) => {

          const date = req.query.date ? req.query.date : null

          const filters = {
               rebookable: req.query.rebookable === '1',
               endedMinAgo: req.query.ended_min_ago ?? null,
               endedMaxAgo: req.query.ended_max_ago ?? null,
               personIds: req.query.person_ids ?? null
          }

          matchcontroller.getBookingsForDate(date, filters)
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

/**
 * Preferred duration and bumpable flag for a chosen match-booking lineup.
 * Must stay above GET /:id so "session-rules" is not parsed as an id.
 */
router.get('/session-rules', authGuard, validate(
     {
          query: z.object({
               player_types: csvIntList({
                    message: 'Invalid player_types',
                    max: 4,
                    maxMessage: 'Too many player_types',
                    item: (n) => MATCH_PLAYER_TYPE_IDS.has(n),
                    itemMessage: 'Unknown player type',
               })
          })
     },
     { payload: () => "Invalid query parameter", logPrefix: "Get session rules parameter error" }
),
     (req, res, next) => {
          try {
               res.json(resolveSessionRules(req.query.player_types))
          } catch (err) {
               next(err instanceof RESTError ? err : new RESTError(422, err.message))
          }
     }
);

/**
 * Suggested participant types for people being added to a same-day booking.
 * Must stay above GET /:id so "player-types" is not parsed as an id.
 */
router.get('/player-types', authGuard, validate(
     {
          query: z.object({
               person_ids: csvIntList({
                    message: 'Invalid person_ids',
                    max: 4,
                    maxMessage: 'Too many person_ids',
                    unique: true,
                    uniqueMessage: 'Duplicate person_ids',
                    item: (n) => Number.isSafeInteger(n) && n > 0,
                    itemMessage: 'Invalid person_ids',
               })
          })
     },
     { payload: () => "Invalid query parameter", logPrefix: "Get player types parameter error" }
),
     (req, res, next) => {
          matchcontroller.suggestPlayerTypesForToday(req.query.person_ids)
               .then((result) => {
                    res.json(result)
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
                              'player_type_id': player.player_type_id,
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
