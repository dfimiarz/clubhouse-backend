const express = require('express')
const { check, validationResult, body, query } = require('express-validator')
const controller = require('./controller')
const RESTError = require('./../utils/RESTError');
const { authGuard } = require('../middleware/clientauth')
const authcontroller = require('../auth/controller')
const utils = require('../utils/utils')
const rateLimiter = require('../rate-limiter/rate-limiter')

const router = express.Router();

router.use(express.json())

function formatFieldErrors(errors) {
     return errors.array({ onlyFirstError: true }).map((error) => ({
          param: error.param || error.path,
          msg: error.msg
     }))
}

/**
 * Route to get all persons
 */
router.get('/', authGuard, (req, res, next) => {

     controller.getPersons()
          .then((persons) => {
               res.json(persons)
          })
          .catch((err) => {
               next(err)
          })


});

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
router.get('/active', authGuard, [
     query('search').optional().isString().trim().isLength({ min: 2, max: 50 }).withMessage("Search must be between 2 and 50 characters"),
     query('ids').optional().matches(/^\d+(,\d+)*$/).withMessage("ids must be a comma separated list of integers")
          .custom((value) => value.split(',').length <= 10).withMessage("Too many ids"),
     query('host').optional().isIn(['1']).withMessage("host must be 1")
], (req, res, next) => {

     const errors = validationResult(req);

     if (!errors.isEmpty()) {
          return next(new RESTError(422, { fielderrors: formatFieldErrors(errors) }))
     }

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

router.get('/members', authGuard, (req, res, next) => {

     controller.getMembers()
          .then((members) => {
               res.json(members)
          })
          .catch((err) => {
               next(err)
          })
});

router.get('/members/active', authGuard, (req, res, next) => {

     controller.getActiveMembers()
          .then((guests) => {
               res.json(guests)
          })
          .catch((err) => {
               next(err)
          })


});

router.get('/guests', authGuard, (req, res, next) => {

     controller.getGuests()
          .then((guests) => {
               res.json(guests)
          })
          .catch((err) => {
               next(err)
          })


})

router.get('/guests/inactive', authGuard, (req, res, next) => {

     controller.getInactiveGuests()
          .then((guests) => {
               res.json(guests)
          })
          .catch((err) => {
               next(err)
          })


})

router.get('/guests/active', authGuard, (req, res, next) => {

     controller.getActiveGuests()
          .then((guests) => {
               res.json(guests)
          })
          .catch((err) => {
               next(err)
          })


})

router.post('/guests', rateLimiter.guestregistrationlimiter, [
     body('email').isString().trim().notEmpty().withMessage("Field cannot be empty").isEmail().withMessage("Invalid E-mail Address").customSanitizer((value) => utils.normalizeEmail(value)),
     body('firstname').isString().trim().notEmpty().withMessage("Field cannot be empty").isLength({ min: 2, max: 32}).withMessage("Must be between 2 and 32 characters long").customSanitizer((value) => utils.normalizeWhitespace(value)),
     body('lastname').isString().trim().notEmpty().withMessage("Field cannot be empty").isLength({ min: 2, max: 32}).withMessage("Must be between 2 and 32 characters long").customSanitizer((value) => utils.normalizeWhitespace(value)),
     body('phone').optional({ checkFalsy: true }).trim().isMobilePhone('en-US').withMessage("Must be a valid phone number").customSanitizer((value) => utils.normalizePhone(value)),
     check('agreement').exists().isBoolean().isIn([true]).withMessage("Agreement required")
], async (req, res, next) => {

     //Check if captcha is set for users that are not logged in
     if (!utils.isAuthenticated(res)) {
          await body('hcaptcha').notEmpty().withMessage("hCaptcha must be set").run(req);
     }

     const errors = validationResult(req);

     if (!errors.isEmpty()) {
          return next(new RESTError(422, { fielderrors: formatFieldErrors(errors) }))
     }

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
