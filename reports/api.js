const express = require('express')
const { z } = require('zod');
const { validate, iso8601 } = require('./../utils/validate');
const { roleGuard } = require('../middleware/clientauth');
const roles = require('../utils/SystemRoles')
const { getReportTypes } = require('./reportTypes');
const { runProcessor } = require('./controller');
const { getClubInfo } = require('../club/controller');
const { validateDateRange } = require('../utils/DateRangeValidator');

const router = express.Router();

router.use(express.json());


/**
 *  Route to get all reports
 */
router.get('/', roleGuard([roles.ADMIN, roles.MANAGER]), (req, res, _next) => {

    res.json(
        getReportTypes()
    );
});

/**
 * Route to get a report based on the report name
 */
const reportParams = z.object({
    type: z.string("Invalid report name").refine(
        (value) => getReportTypes().includes(value),
        "Invalid report type"
    )
});

const reportQuery = z.object({
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

router.get('/:type', roleGuard([roles.ADMIN, roles.MANAGER]), validate(
    { params: reportParams, query: reportQuery },
    { status: 400, payload: (fielderrors) => fielderrors }
), async (req, res, next) => {

    try {
        //Get the club time zone
        const { time_zone } = await getClubInfo();

        //get query parameters
        const { from, to } = validateDateRange(req.query.from, req.query.to, time_zone);

        //Run processor
        const result = await runProcessor(req.params.type, from, to);

        //Construct response
        const reponse_payload = {
            report: req.params.type,
            from: from,
            to: to,
            result: result
        }

        //Send result
        res.json(reponse_payload);
    }
    catch (err) {
        next(err);
    }

})

module.exports = router;
