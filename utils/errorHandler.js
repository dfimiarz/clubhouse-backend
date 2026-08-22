const RESTError = require("./RESTError");
const { DEFAULT_PAYLOAD } = RESTError;
// Held as a module object so tests can replace logger.log and observe the call.
const logger = require("./logger/logger");
const { appLogLevels } = logger;

/**
 * Final Express error middleware.
 *
 * RESTError is the only type whose status and body are sent to the client.
 * Everything else is logged and replaced with a generic 500 so driver
 * messages, stack traces, and opcodes never leave the process.
 */
function errorHandler(err, _req, res, _next) {
    if (err instanceof RESTError) {
        res.status(err.status).json(err.payload);
        return;
    }

    logger.log(appLogLevels.ERROR, err.stack || err.message || String(err));
    res.status(500).json(DEFAULT_PAYLOAD);
}

module.exports = errorHandler;
