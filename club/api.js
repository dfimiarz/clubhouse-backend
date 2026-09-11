const express = require('express');
const { z } = require('zod');
const controller = require('./controller');
const { publicreadlimiter } = require('../rate-limiter/rate-limiter');
const { authGuard, roleGuard } = require('../middleware/clientauth');
const { ROLES } = require('../utils/dbconstants');
const { validate } = require('../utils/validate');
const { DEFAULT_SESSION_DURATION_POLICY, sessionDurationPolicySchema } = require('./sessionDurationPolicy');
const sessionDurationSettings = require('./sessionDurationSettings');
const { DEFAULT_BUMPABILITY_POLICY, bumpabilityPolicySchema } = require('./bumpabilityPolicy');
const bumpabilitySettings = require('./bumpabilitySettings');
const guestAccompanimentSettings = require('./guestAccompanimentSettings');
const { SETTINGS } = require('./settings');
const restrictedMemberSettings = require('./restrictedMemberSettings');

const router = express.Router();

router.use(express.json())

router.get('/restricted-member-roles', authGuard, roleGuard(ROLES.ADMIN), async (_req, res, next) => {
     try {
          res.set('Cache-Control', 'no-store').json(await restrictedMemberSettings.getRestrictedMemberRoles());
     } catch (err) {
          next(err);
     }
});

router.put('/restricted-member-roles/:id', authGuard, roleGuard(ROLES.ADMIN),
     validate({ params: restrictedMemberSettings.roleParams, body: restrictedMemberSettings.restrictedMemberSchema }),
     async (req, res, next) => {
          try {
               res.json(await restrictedMemberSettings.saveRestrictedMemberRole(req.params.id, req.body));
          } catch (err) {
               next(err);
          }
     });

router.get('/guest-accompaniment', authGuard, roleGuard(ROLES.ADMIN), async (req, res, next) => {
     try {
          const required = await guestAccompanimentSettings.getGuestAccompaniment();
          res.set('Cache-Control', 'no-store').json({
               required, default: SETTINGS.require_guests_accompanied_by_member.default,
          });
     } catch (err) {
          next(err);
     }
});

router.put('/guest-accompaniment', authGuard, roleGuard(ROLES.ADMIN),
     validate({ body: z.strictObject({ required: z.boolean() }) }), async (req, res, next) => {
          try {
               const required = await guestAccompanimentSettings.saveGuestAccompaniment(req.body.required);
               res.json({ required, default: SETTINGS.require_guests_accompanied_by_member.default });
          } catch (err) {
               next(err);
          }
     });

router.get('/session-duration-policy', authGuard, roleGuard(ROLES.ADMIN), async (req, res, next) => {
     try {
          const policy = await sessionDurationSettings.getSessionDurationPolicy();
          res.set('Cache-Control', 'no-store').json({ policy, defaults: DEFAULT_SESSION_DURATION_POLICY });
     } catch (err) {
          next(err);
     }
});

router.put('/session-duration-policy', authGuard, roleGuard(ROLES.ADMIN),
     validate({ body: sessionDurationPolicySchema }), async (req, res, next) => {
          try {
               const policy = await sessionDurationSettings.saveSessionDurationPolicy(req.body);
               res.json({ policy, defaults: DEFAULT_SESSION_DURATION_POLICY });
          } catch (err) {
               next(err);
          }
     });

router.get('/bumpability-policy', authGuard, roleGuard(ROLES.ADMIN), async (req, res, next) => {
     try {
          const policy = await bumpabilitySettings.getBumpabilityPolicy();
          res.set('Cache-Control', 'no-store').json({ policy, default: DEFAULT_BUMPABILITY_POLICY });
     } catch (err) {
          next(err);
     }
});

router.put('/bumpability-policy', authGuard, roleGuard(ROLES.ADMIN),
     validate({ body: z.strictObject({ policy: bumpabilityPolicySchema }) }), async (req, res, next) => {
          try {
               const policy = await bumpabilitySettings.saveBumpabilityPolicy(req.body.policy);
               res.json({ policy, default: DEFAULT_BUMPABILITY_POLICY });
          } catch (err) {
               next(err);
          }
     });

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
