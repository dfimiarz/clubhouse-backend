const express = require('express')
const { z } = require('zod')
const validator = require('validator')
const { validate } = require('./../utils/validate')
const controller = require('./controller')
const RESTError = require('./../utils/RESTError');
const { authGuard } = require('../middleware/clientauth')
const authcontroller = require('../auth/controller')
const utils = require('../utils/utils')
const rateLimiter = require('../rate-limiter/rate-limiter')

const router = express.Router();

router.use(express.json())

router.get('/eventhosts', authGuard, (req, res, next) => {

     controller.getEventHosts()
     .then((hosts) => {
          res.json(hosts)
     }
     )
     .catch((err) => {
          next(err)
     }
     )
})

/**
 * Route to get active persons, optionally filtered by name search,
 * a list of ids (takes precedence over search), or guest host status.
 * Without params returns the full active list.
 */
const activePersonsQuery = z.object({
     search: z.string("Search must be between 2 and 50 characters").trim()
          .min(2, "Search must be between 2 and 50 characters")
          .max(50, "Search must be between 2 and 50 characters")
          .optional(),
     ids: z.string("ids must be a comma separated list of integers")
          .regex(/^\d+(,\d+)*$/, "ids must be a comma separated list of integers")
          .refine((value) => value.split(',').length <= 10, "Too many ids")
          .optional(),
     host: z.literal('1', "host must be 1").optional()
})

router.get('/active', authGuard, validate({ query: activePersonsQuery }), (req, res, next) => {

     const filters = {
          search: req.query.search ? String(req.query.search).trim() : undefined,
          ids: req.query.ids ? req.query.ids.split(',').map(Number) : undefined,
          host: req.query.host === '1'
     }

     controller.getActivePersons(filters)
     .then((persons) => {
          res.json(persons)
     })
     .catch((err) => {
          next(err)
     })
});

const EMPTY_FIELD = "Field cannot be empty"
const NAME_LENGTH = "Must be between 2 and 32 characters long"

const guestName = z.string(EMPTY_FIELD).trim()
     .min(1, EMPTY_FIELD)
     .min(2, NAME_LENGTH)
     .max(32, NAME_LENGTH)
     .transform((value) => utils.normalizeWhitespace(value))

const guestBody = z.object({
     email: z.string(EMPTY_FIELD).trim()
          .min(1, EMPTY_FIELD)
          .refine((value) => validator.isEmail(value), "Invalid E-mail Address")
          .transform((value) => utils.normalizeEmail(value)),
     firstname: guestName,
     lastname: guestName,
     //Every falsy phone number is treated as absent, as optional({ checkFalsy: true }) did
     phone: z.preprocess(
          (value) => (value ? value : undefined),
          z.string().trim()
               .refine((value) => validator.isMobilePhone(value, 'en-US'), "Must be a valid phone number")
               .transform((value) => utils.normalizePhone(value))
               .optional()
     ),
     agreement: z.union([z.literal(true), z.literal('true')], { error: "Agreement required" })
})

/**
 * Guests registering while logged out must clear a captcha, so the hcaptcha
 * rule depends on the auth state of the request.
 *
 * @param {import('express').Request} _req
 * @param {import('express').Response} res
 * @returns {Object}
 */
function guestSchemas(_req, res) {
     //Authenticated callers never have the token checked, so it is left unvalidated
     //rather than typed: the client posts hcaptcha: null when the widget is hidden.
     const hcaptcha = utils.isAuthenticated(res)
          ? z.any().optional()
          : z.string("hCaptcha must be set").min(1, "hCaptcha must be set")

     return { body: guestBody.extend({ hcaptcha }) }
}

router.post('/guests', rateLimiter.guestregistrationlimiter, validate(guestSchemas), async (req, res, next) => {

     try {
          //Run captcha verification is users is not authenticated
          if (! utils.isAuthenticated(res)) {
               const verification = await authcontroller.verifyhCaptcha(req.body.hcaptcha, {
                    remoteip: req.ip,
               });

               if (verification.replayed) {
                    throw new RESTError(422,{ fielderrors: [{ param: "hcaptcha", msg: "Captcha token already used"}]});
               }

               if (!verification.hostnameValid) {
                    throw new RESTError(422,{ fielderrors: [{ param: "hcaptcha", msg: "Captcha hostname check failed"}]});
               }

               if (!verification.success) {
                    throw new RESTError(422,{ fielderrors: [{ param: "hcaptcha", msg: "Failed to verify captcha"}]});
               }
          }

          await controller.addGuest(req);

          res.status(201).send();
     }
     catch (err) {
          return next(err)
     }

})

module.exports = router
