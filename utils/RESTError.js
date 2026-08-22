const DEFAULT_PAYLOAD = Object.freeze({ errors: "Something went wrong" });

/**
 * Expected HTTP failure. The error handler sends `payload` as the JSON body
 * and never falls through to a generic 500.
 *
 * Extends Error so `err.message` / `err.stack` work in logs and so Express
 * treats it as an error. Unexpected failures should stay plain Errors.
 */
class RESTError extends Error {
    constructor(status = 500, payload = DEFAULT_PAYLOAD) {
        super(typeof payload === "string" ? payload : DEFAULT_PAYLOAD.errors);
        this.name = "RESTError";
        this._status = status;
        this._payload = payload;
    }

    get payload() {
        return this._payload;
    }

    get status() {
        return this._status;
    }
}

module.exports = RESTError;
module.exports.DEFAULT_PAYLOAD = DEFAULT_PAYLOAD;
