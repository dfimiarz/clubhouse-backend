const express = require('express');
const { z } = require('zod');
const { validate, iso8601 } = require('./../utils/validate');
const activities_ctrl = require('./controller');
const { authGuard } = require('../middleware/clientauth');
const RESTError = require('./../utils/RESTError');
const { log, appLogLevels } = require('./../utils/logger/logger');
const { validateDateRange } = require('./../utils/DateRangeValidator');
const { getClubInfo } = require('../club/controller');

const router = express.Router();

router.use(express.json());

const dateRangeQuery = z.object({
    from: iso8601("Invalid FROM date").optional(),
    to: iso8601("Invalid TO date").optional()
})
    //if from or to is set, both must be set
    .refine((value) => !value.from || value.to, {
        path: ['from'],
        error: 'TO date is required'
    })
    .refine((value) => !value.to || value.from, {
        path: ['to'],
        error: 'FROM date is required'
    });

router.get('/', authGuard, validate(
    { query: dateRangeQuery },
    { status: 400, payload: (fielderrors) => fielderrors }
), async (req, res, next) => {

    try {

        //Get the club time zone
        const { time_zone } = await getClubInfo();

        //get query parameters
        const { from, to } = validateDateRange(req.query.from, req.query.to, time_zone);

        const result = await activities_ctrl.getActivitiesForDates(from, to);

        res.json(result);

    } catch (err) {
        log(appLogLevels.ERROR, err);
        next(new RESTError(400, err.message));
    }
});

module.exports = router;