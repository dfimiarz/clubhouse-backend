const sqlconnector = require("../db/SqlConnector");
const { bookingWeekday } = require("../guest-pass-types/weekdays");

// Court open hours from every schedule overlapping [from, to]. Matches the
// booking check in bookings/BookingUtils.js: `to` is inclusive and dayofweek
// follows MySQL DAYOFWEEK (Sunday = 1).
const OPEN_HOURS_Q = `SELECT
                        DATE_FORMAT(cs.\`from\`, "%Y-%m-%d") AS \`from\`,
                        DATE_FORMAT(cs.\`to\`, "%Y-%m-%d") AS \`to\`,
                        csi.dayofweek,
                        time_to_sec(csi.open) DIV 60 AS open_min,
                        time_to_sec(csi.close) DIV 60 AS close_min
                      FROM club_schedule cs
                      JOIN court_schedule_item csi ON csi.schedule = cs.id
                      WHERE cs.club = ? AND cs.\`to\` >= ? AND cs.\`from\` <= ?`;

/**
 * @typedef {{ from: string, to: string, dayofweek: number, open_min: number, close_min: number }} OpenHoursRow
 */

/**
 * @param {*} connection
 * @param {unknown} clubId
 * @param {string} from Club-local YYYY-MM-DD, inclusive.
 * @param {string} to Club-local YYYY-MM-DD, inclusive.
 * @param {{ lock?: boolean }} [options]
 * @returns {Promise<OpenHoursRow[]>}
 */
async function loadOpenHours(connection, clubId, from, to, { lock = false } = {}) {
    const query = lock ? `${OPEN_HOURS_Q}\n                      FOR SHARE` : OPEN_HOURS_Q;
    const rows = await sqlconnector.runExecute(connection, query, [clubId, from, to]);
    if (!Array.isArray(rows)) {
        throw new Error("Unable to read club open hours");
    }
    return rows.map((row) => ({
        from: row.from,
        to: row.to,
        dayofweek: Number(row.dayofweek),
        open_min: Number(row.open_min),
        close_min: Number(row.close_min),
    }));
}

/**
 * Open court time frames (any court) on a club-local date.
 *
 * @param {OpenHoursRow[]} rows
 * @param {string} date YYYY-MM-DD
 * @returns {Array<{ open_min: number, close_min: number }>}
 */
function openFramesOn(rows, date) {
    const isoDay = bookingWeekday(date);
    if (isoDay == null) return [];
    // ISO Monday = 1 ... Sunday = 7 to DAYOFWEEK Sunday = 1 ... Saturday = 7.
    const dayofweek = isoDay % 7 + 1;
    return rows.filter((row) => row.from <= date && date <= row.to && row.dayofweek === dayofweek);
}

module.exports = { loadOpenHours, openFramesOn };
