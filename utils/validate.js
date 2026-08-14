const { z } = require('zod');
const validator = require('validator');
const RESTError = require('./RESTError');
const { log, appLogLevels } = require('./logger/logger');

const SOURCES = ['params', 'query', 'body'];

/**
 * Renders a zod issue path the way express-validator named fields, so error
 * payloads keep pointing at "players[0].id" rather than "players.0.id".
 *
 * @param {Array<string|number>} path
 * @returns {string}
 */
function pathToParam(path) {
    return path.reduce((acc, segment) => {
        if (typeof segment === 'number') {
            return `${acc}[${segment}]`;
        }

        return acc === '' ? String(segment) : `${acc}.${segment}`;
    }, '');
}

/**
 * Normalizes zod issues into the field errors the API returns.
 *
 * Only the first issue per field is kept, matching the
 * errors.array({ onlyFirstError: true }) the routes used to call.
 *
 * @param {Array<import('zod').core.$ZodIssue>} issues
 * @returns {Array<{param: string, msg: string}>}
 */
function formatFieldErrors(issues) {
    const seen = new Set();

    return issues.reduce((acc, issue) => {
        const param = pathToParam(issue.path);

        if (seen.has(param)) {
            return acc;
        }

        seen.add(param);
        acc.push({ param, msg: issue.message });

        return acc;
    }, []);
}

/**
 * Builds a validation middleware from zod schemas.
 *
 * On success the parsed (coerced and trimmed) values replace req.params,
 * req.query and req.body, so handlers read validated data through the same
 * properties as before. On failure the request is rejected with a RESTError
 * and the handler never runs.
 *
 * @param {Object|Function} schemas Map of source to schema, keyed by params,
 *        query and body. May instead be a (req, res) => map factory when the
 *        rules depend on the request, such as auth state.
 * @param {Object} [options]
 * @param {number} [options.status=422] Status for the rejection
 * @param {(fielderrors: Array<Object>) => *} [options.payload] Builds the response
 *        body from the field errors. Defaults to { fielderrors }
 * @param {string} [options.logPrefix] When set, failures are logged with this prefix
 * @returns {import('express').RequestHandler}
 */
function validate(schemas, options = {}) {
    const { status = 422, payload, logPrefix } = options;

    return (req, res, next) => {
        const issues = [];
        const resolved = typeof schemas === 'function' ? schemas(req, res) : schemas;

        for (const source of SOURCES) {
            const schema = resolved[source];

            if (!schema) {
                continue;
            }

            const result = schema.safeParse(req[source]);

            if (!result.success) {
                issues.push(...result.error.issues);
                continue;
            }

            // req.query is getter-only in Express 5 and a plain assignment is
            // silently dropped, so the property is redefined instead.
            Object.defineProperty(req, source, {
                value: result.data,
                writable: true,
                configurable: true,
                enumerable: true
            });
        }

        if (issues.length === 0) {
            return next();
        }

        const fielderrors = formatFieldErrors(issues);

        if (logPrefix) {
            log(appLogLevels.ERROR, `${logPrefix}: ${JSON.stringify(fielderrors)}`);
        }

        return next(new RESTError(status, payload ? payload(fielderrors) : { fielderrors }));
    };
}

/**
 * Time of day as HH:MM on a 24 hour clock.
 *
 * @param {string} message
 * @returns {import('zod').ZodType}
 */
function hhmm(message) {
    return z.string(message).regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, message);
}

/**
 * Calendar date as YYYY-MM-DD, kept as a string to avoid timezone day-shift.
 *
 * @param {string} message
 * @returns {import('zod').ZodType}
 */
function isoDate(message) {
    return z.iso.date(message);
}

/**
 * Any ISO8601 value, delegating to the same validator express-validator used
 * so date-only and full timestamps are both still accepted.
 *
 * @param {string} message
 * @returns {import('zod').ZodType}
 */
function iso8601(message) {
    return z.string(message).refine((value) => validator.isISO8601(value), message);
}

/**
 * Integer that tolerates the string form query strings and JSON bodies arrive in.
 *
 * Coercion is deliberately not done with z.coerce, which runs Number() and so
 * would turn '', '  ', null, [] and false into 0 and true into 1. Only numbers
 * and strings that spell out an integer are accepted, matching isInt().
 *
 * @param {string} message
 * @returns {import('zod').ZodType}
 */
function intLike(message) {
    return z
        .union([z.number(), z.string().regex(/^[+-]?\d+$/, message)], { error: message })
        .transform(Number)
        .pipe(z.number(message).int(message));
}

/**
 * Integer that reports a distinct message when the field is absent.
 *
 * A missing value fails the integer check with the same message an invalid one
 * does, so presence is asserted first and only then piped into that check.
 *
 * @param {string} missingMessage Reported when the field is not set
 * @param {string} invalidMessage Reported when the field is set but not an integer
 * @returns {import('zod').ZodType}
 */
function requiredIntLike(missingMessage, invalidMessage) {
    return z.custom((value) => value !== undefined, missingMessage).pipe(intLike(invalidMessage));
}

/**
 * Comma-separated integers from a query string ("1,2,3"), parsed to number[].
 *
 * @param {Object} options
 * @param {string} options.message Format error
 * @param {number} [options.max] Max list length
 * @param {string} [options.maxMessage='Too many values']
 * @param {boolean} [options.unique=false]
 * @param {string} [options.uniqueMessage='Duplicate values']
 * @param {(n: number) => boolean} [options.item] Predicate each id must pass
 * @param {string} [options.itemMessage='Invalid value']
 * @returns {import('zod').ZodType<number[]>}
 */
function csvIntList(options = {}) {
    const {
        message,
        max,
        maxMessage = 'Too many values',
        unique = false,
        uniqueMessage = 'Duplicate values',
        item,
        itemMessage = 'Invalid value'
    } = options;

    let schema = z
        .string(message)
        .regex(/^\d+(,\d+)*$/, message)
        .transform((value) => value.split(',').map(Number));

    if (max != null) {
        schema = schema.refine((ids) => ids.length <= max, { error: maxMessage });
    }

    if (unique) {
        schema = schema.refine((ids) => new Set(ids).size === ids.length, {
            error: uniqueMessage
        });
    }

    if (item) {
        schema = schema.refine((ids) => ids.every(item), { error: itemMessage });
    }

    return schema;
}

module.exports = {
    validate,
    hhmm,
    isoDate,
    iso8601,
    intLike,
    requiredIntLike,
    csvIntList
};
