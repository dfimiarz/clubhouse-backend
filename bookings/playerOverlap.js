const sqlconnector = require("../db/SqlConnector");
const RESTError = require("../utils/RESTError");
const { resolveSettings } = require("../club/settings");
const { checkPlayerOverlap } = require("./BookingUtils");
const { MEMBER_ACTIVITY_GROUP_ID } = require("./playerType");
const { log, appLogLevels } = require("../utils/logger/logger");

const CLUB_ID = process.env.CLUB_ID;

const SETTING_KEY = "prevent_concurrent_member_bookings";

/**
 * @param {unknown} players
 * @returns {number[]}
 */
function personIdsFromPlayers(players) {
    if (!Array.isArray(players)) {
        return [];
    }

    const ids = [];
    const seen = new Set();

    players.forEach((player) => {
        const id = Number(player?.person_id);
        if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id)) {
            return;
        }
        seen.add(id);
        ids.push(id);
    });

    return ids;
}

/**
 * @param {{ settingEnabled?: boolean, groupId?: unknown, personIds?: unknown }} params
 * @returns {boolean}
 */
function shouldCheckPlayerOverlap({ settingEnabled, groupId, personIds }) {
    if (settingEnabled !== true) {
        return false;
    }
    if (Number(groupId) !== MEMBER_ACTIVITY_GROUP_ID) {
        return false;
    }
    return Array.isArray(personIds) && personIds.length > 0;
}

/**
 * @param {{ firstname?: string, lastname?: string }} row
 * @returns {string}
 */
function personDisplayName(row) {
    const first = String(row?.firstname ?? "").trim();
    const last = String(row?.lastname ?? "").trim();
    const name = [first, last].filter(Boolean).join(" ");
    return name || "A player";
}

/**
 * One sentence per conflicting person; first court wins if they appear twice.
 *
 * @param {Array<{ person_id?: number, firstname?: string, lastname?: string, court_name?: string }>} rows
 * @returns {string}
 */
function formatPlayerOverlapMessage(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
        return "A player is already booked at this time.";
    }

    const seen = new Set();
    const parts = [];

    rows.forEach((row) => {
        const id = Number(row.person_id);
        if (Number.isSafeInteger(id) && seen.has(id)) {
            return;
        }
        if (Number.isSafeInteger(id)) {
            seen.add(id);
        }
        const court = String(row.court_name ?? "").trim() || "another court";
        parts.push(`${personDisplayName(row)} is already booked on ${court} at this time.`);
    });

    return parts.join(" ");
}

/**
 * Read the club flag from `club_setting` on this connection (not Redis).
 *
 * @param {*} connection
 * @returns {Promise<boolean>}
 */
async function isPreventConcurrentMemberBookingsEnabled(connection) {
    const rows = await sqlconnector.runQuery(
        connection,
        `SELECT setting_key, setting_value
         FROM club_setting
         WHERE club = ?
           AND setting_key = ?`,
        [CLUB_ID, SETTING_KEY]
    );

    const resolved = resolveSettings(Array.isArray(rows) ? rows : [], {
        publicOnly: false,
    });

    return resolved[SETTING_KEY] === true;
}

/**
 * Serialize bookings that mention these people.
 *
 * @param {*} connection
 * @param {number[]} personIds
 */
async function lockPersonsForUpdate(connection, personIds) {
    if (!Array.isArray(personIds) || personIds.length === 0) {
        return;
    }

    const orderedIds = [...personIds].sort((a, b) => a - b);

    await sqlconnector.runQuery(
        connection,
        `SELECT id FROM person WHERE id IN ? AND club = ? FOR UPDATE`,
        [[orderedIds], CLUB_ID]
    );
}

/**
 * Exclusive-lock the roster when this write is a member-group booking and the
 * club flag is on. Callers must do this before any activity FOR UPDATE so add
 * and move share one lock order: people, then activities.
 *
 * @param {*} connection
 * @param {{ group_id?: unknown, players?: Array }} booking
 */
async function lockRosterIfNeeded(connection, booking) {
    const settingEnabled = await isPreventConcurrentMemberBookingsEnabled(connection);
    const personIds = personIdsFromPlayers(booking?.players);

    if (
        !shouldCheckPlayerOverlap({
            settingEnabled,
            groupId: booking?.group_id,
            personIds,
        })
    ) {
        return false;
    }

    await lockPersonsForUpdate(connection, personIds);
    return true;
}

/**
 * Reject a member-group write when a roster player already has an overlapping
 * member session. Role of the requester is not considered. Locks the roster
 * first when the check applies.
 *
 * @param {*} connection
 * @param {{ date: string, start: string, end: string, group_id?: unknown, players?: Array }} booking
 */
async function assertNoConcurrentMemberBookings(connection, booking) {
    const shouldCheck = await lockRosterIfNeeded(connection, booking);
    if (!shouldCheck) {
        return;
    }

    const personIds = personIdsFromPlayers(booking.players);

    const conflicts = await checkPlayerOverlap(connection, {
        date: booking.date,
        start: booking.start,
        end: booking.end,
        personIds,
        groupId: MEMBER_ACTIVITY_GROUP_ID,
    });

    if (conflicts.length === 0) {
        return;
    }

    log(
        appLogLevels.WARNING,
        `Player overlap found: ${JSON.stringify({
            booking_date: booking.date,
            booking_start: booking.start,
            booking_end: booking.end,
            person_ids: personIds,
            conflicting_ids: conflicts.map((row) => row.id),
        })}`
    );

    throw new RESTError(422, formatPlayerOverlapMessage(conflicts));
}

module.exports = {
    SETTING_KEY,
    personIdsFromPlayers,
    shouldCheckPlayerOverlap,
    formatPlayerOverlapMessage,
    isPreventConcurrentMemberBookingsEnabled,
    lockPersonsForUpdate,
    lockRosterIfNeeded,
    assertNoConcurrentMemberBookings,
};
