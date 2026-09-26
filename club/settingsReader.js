const sqlconnector = require("../db/SqlConnector");
const { resolveSettings } = require("./settings");

const CLUB_ID = process.env.CLUB_ID;

/**
 * Read several club settings in one query, straight from the database (not
 * Redis). Reuses the caller's connection when supplied so a booking
 * transaction validates against the rows it read. Keys with no row get the
 * registry default.
 *
 * @param {*} connection Open connection, or null to borrow one
 * @param {string[]} keys Setting keys from the settings registry
 * @returns {Promise<Object<string, unknown>>} value per requested key
 */
async function readClubSettings(connection, keys) {
    if (!Array.isArray(keys) || keys.length === 0) {
        return {};
    }
    if (!connection) {
        // Through the exported object, so a test double of readClubSettings
        // also sees the connection-borrowing call
        return sqlconnector.withConnection((conn) => api.readClubSettings(conn, keys));
    }

    // Prepared statement like the single-setting readers; one placeholder per key
    const rows = await sqlconnector.runExecute(
        connection,
        `SELECT setting_key, setting_value
         FROM club_setting
         WHERE club = ?
           AND setting_key IN (${keys.map(() => "?").join(", ")})`,
        [CLUB_ID, ...keys]
    );

    const resolved = resolveSettings(Array.isArray(rows) ? rows : [], {
        publicOnly: false,
    });

    return Object.fromEntries(keys.map((key) => [key, resolved[key]]));
}

/**
 * Callers use settingsReader.readClubSettings(...) rather than destructuring,
 * so tests can replace it (same pattern as SqlConnector's `api`).
 */
const api = { readClubSettings };

module.exports = api;
