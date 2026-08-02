const transactionType = {
    NO_TRANSACTION: 0,
    READ_TRANSACTION: 1,
    WRITE_TRANSACTION: 2
}

/**
 * 
 * @param {String} query SQL query to format
 * @param {Number} t_type Transaction type as defined in transactionType
 * @returns {String} SQL query with transaction specific formatting
 */
function formatQuery(query, t_type) {
    switch (t_type) {
        case transactionType.READ_TRANSACTION:
            //Add LOCK IN SHARE MODE to query text if read transaction
            return query + " LOCK IN SHARE MODE";
        case transactionType.WRITE_TRANSACTION:
            //Add FOR UPDATE to query text if write transaction
            return query + " FOR UPDATE";
        default:
            //Return query as is if no transaction
            return query;
    }
}

/**
 * Read a value coming from a MySQL `json` column (or a JSON-typed expression
 * such as JSON_MERGE_PATCH).
 *
 * mysql2 parses these into JS values for us, whereas the mysql driver returned
 * the raw string. Accept both so callers never double-parse.
 *
 * @param {*} value Value as returned by the driver
 * @returns {*} Parsed JSON value
 */
function parseJsonColumn(value) {
    return typeof value === "string" ? JSON.parse(value) : value;
}

module.exports = {
    formatQuery,
    parseJsonColumn,
    transactionType
}