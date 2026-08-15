const sqlconnector = require("../db/SqlConnector");
const RESTError = require("../utils/RESTError");
const { resolveSettings } = require("../club/settings");
const {
    loadSettingsByPassType,
    settingsForPassType,
} = require("../guest-pass-types/settings");
const { evaluatePassRules, earliestPlayAfter } = require("../guest-pass-types/rules");
const { personIdsFromPlayers } = require("./playerOverlap");
const { log, appLogLevels } = require("../utils/logger/logger");

const CLUB_ID = process.env.CLUB_ID;

const SETTING_KEY = "require_guests_accompanied_by_member";

// Membership covering the booking date whose role requires a guest pass.
const pass_requiring_players_q = `SELECT p.id, p.firstname, p.lastname
                                  FROM person p
                                  JOIN membership m
                                    ON m.person_id = p.id
                                   AND ? >= m.valid_from
                                   AND ? < m.valid_until
                                  JOIN role r ON r.id = m.role
                                  JOIN role_type rt ON rt.id = r.type
                                  WHERE p.id IN ?
                                    AND p.club = ?
                                    AND rt.requires_pass = 1
                                  LOCK IN SHARE MODE`;

// date + start and guest_pass.valid_from/valid_to are club-local datetimes.
const covering_guest_pass_q = `SELECT gp.guest_id, gp.type
                               FROM guest_pass gp
                               JOIN person p ON p.id = gp.guest_id
                               JOIN guest_pass_type gpt
                                 ON gpt.id = gp.type
                                AND gpt.club_id = ?
                               WHERE gp.guest_id IN ?
                                 AND p.club = ?
                                 AND gp.valid = 1
                                 AND TIMESTAMP(?, ?) BETWEEN gp.valid_from AND gp.valid_to
                               LOCK IN SHARE MODE`;

/**
 * @param {{ firstname?: string, lastname?: string }} row
 * @returns {string}
 */
function personDisplayName(row) {
    const first = String(row?.firstname ?? "").trim();
    const last = String(row?.lastname ?? "").trim();
    const name = [first, last].filter(Boolean).join(" ");
    return name || "A guest";
}

/**
 * One sentence per person missing a covering pass.
 *
 * @param {Array<{ person_id?: number, id?: number, firstname?: string, lastname?: string }>} guests
 * @returns {string}
 */
function formatMissingGuestPassMessage(guests) {
    if (!Array.isArray(guests) || guests.length === 0) {
        return "A guest does not have a valid guest pass.";
    }

    const seen = new Set();
    const parts = [];

    guests.forEach((row) => {
        const id = Number(row.id ?? row.person_id);
        if (Number.isSafeInteger(id) && seen.has(id)) {
            return;
        }
        if (Number.isSafeInteger(id)) {
            seen.add(id);
        }
        parts.push(`${personDisplayName(row)} does not have a valid guest pass.`);
    });

    return parts.join(" ");
}

/**
 * One sentence per guest whose covering pass fails play_after.
 *
 * @param {Array<{ firstname?: string, lastname?: string, play_after?: string }>} guests
 * @returns {string}
 */
function formatPlayAfterMessage(guests) {
    if (!Array.isArray(guests) || guests.length === 0) {
        return "A guest's guest pass does not allow play before this time.";
    }

    const seen = new Set();
    const parts = [];

    guests.forEach((row) => {
        const id = Number(row.id ?? row.person_id);
        if (Number.isSafeInteger(id) && seen.has(id)) {
            return;
        }
        if (Number.isSafeInteger(id)) {
            seen.add(id);
        }
        const clock = row.play_after || "this time";
        parts.push(
            `${personDisplayName(row)}'s guest pass does not allow play before ${clock}.`
        );
    });

    return parts.join(" ");
}

/**
 * @param {Array<{ id?: unknown }>} guests
 * @param {unknown[]} coveredIds
 * @returns {Array<{ id?: unknown }>}
 */
function guestsMissingCoveringPass(guests, coveredIds) {
    const covered = new Set(
        (Array.isArray(coveredIds) ? coveredIds : []).map((id) => Number(id))
    );

    return (Array.isArray(guests) ? guests : []).filter((guest) => {
        const id = Number(guest?.id);
        return Number.isSafeInteger(id) && id > 0 && !covered.has(id);
    });
}

/**
 * Roster people whose membership on `date` requires an active guest pass.
 * Duplicate membership rows collapse to one person.
 *
 * @param {*} connection
 * @param {number[]} personIds
 * @param {string} date
 * @returns {Promise<Array<{ id: number, firstname: string, lastname: string }>>}
 */
async function findPassRequiringPlayers(connection, personIds, date) {
    const rows = await sqlconnector.runQuery(
        connection,
        pass_requiring_players_q,
        [date, date, [personIds], CLUB_ID]
    );

    if (!Array.isArray(rows)) {
        throw new Error("Unable to check guest pass requirements");
    }

    const seen = new Set();
    const guests = [];

    rows.forEach((row) => {
        const id = Number(row.id);
        if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id)) {
            return;
        }
        seen.add(id);
        guests.push({
            id,
            firstname: row.firstname,
            lastname: row.lastname,
        });
    });

    return guests;
}

/**
 * Date-window covering passes. Type is needed so play_after (and later rules)
 * can be evaluated per pass.
 *
 * @param {*} connection
 * @param {number[]} guestIds
 * @param {string} date
 * @param {string} start
 * @returns {Promise<Array<{ guest_id: number, type: number|null }>>}
 */
async function findCoveringPasses(connection, guestIds, date, start) {
    const rows = await sqlconnector.runQuery(
        connection,
        covering_guest_pass_q,
        [CLUB_ID, [guestIds], CLUB_ID, date, start]
    );

    if (!Array.isArray(rows)) {
        throw new Error("Unable to check guest passes");
    }

    const covering = [];

    rows.forEach((row) => {
        const guestId = Number(row.guest_id);
        if (!Number.isSafeInteger(guestId) || guestId <= 0) {
            return;
        }
        const typeId = Number(row.type);
        covering.push({
            guest_id: guestId,
            type: Number.isSafeInteger(typeId) && typeId > 0 ? typeId : null,
        });
    });

    return covering;
}

/**
 * @param {Array<{ guest_id: number }>} covering
 * @returns {number[]}
 */
function coveredGuestIds(covering) {
    const seen = new Set();
    const ids = [];

    (Array.isArray(covering) ? covering : []).forEach((pass) => {
        const id = Number(pass?.guest_id);
        if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id)) {
            return;
        }
        seen.add(id);
        ids.push(id);
    });

    return ids;
}

/**
 * @param {*} connection
 * @param {number[]} guestIds
 * @param {string} date
 * @param {string} start
 * @returns {Promise<number[]>}
 */
async function findGuestsWithCoveringPass(connection, guestIds, date, start) {
    const covering = await findCoveringPasses(connection, guestIds, date, start);
    return coveredGuestIds(covering);
}

/**
 * True when every roster person is a guest (including a solo guest).
 * A guest may play only when at least one non-guest is also on the booking.
 *
 * @param {number[]} personIds
 * @param {Array<{ id?: unknown }>} guests
 * @returns {boolean}
 */
function guestsAreUnaccompanied(personIds, guests) {
    if (!Array.isArray(guests) || guests.length === 0) {
        return false;
    }
    if (!Array.isArray(personIds) || personIds.length === 0) {
        return true;
    }
    return guests.length >= personIds.length;
}

/**
 * Read the club flag from `club_setting` on this connection (not Redis).
 *
 * @param {*} connection
 * @returns {Promise<boolean>}
 */
async function isGuestsAccompaniedByMemberRequired(connection) {
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
 * Reject a guest-only roster when the club flag is on. Any non-guest member
 * (or instructor/manager) is enough; they do not need guest_host.
 *
 * @param {*} connection
 * @param {{ date: string, players?: Array }} booking
 */
async function assertGuestsAccompaniedByMember(connection, booking) {
    const personIds = personIdsFromPlayers(booking?.players);
    if (personIds.length === 0) {
        return;
    }

    const settingEnabled = await isGuestsAccompaniedByMemberRequired(connection);
    if (settingEnabled !== true) {
        return;
    }

    const guests = await findPassRequiringPlayers(
        connection,
        personIds,
        booking.date
    );

    if (!guestsAreUnaccompanied(personIds, guests)) {
        return;
    }

    log(
        appLogLevels.WARNING,
        `Guest booked without a member: ${JSON.stringify({
            booking_date: booking.date,
            guest_ids: guests.map((guest) => guest.id),
        })}`
    );

    throw new RESTError(422, "A guest cannot book without a member.");
}

/**
 * Reject when a roster guest has no valid pass covering the session start.
 * Call after person locks so this SHARE on guest_pass cannot invert lock
 * order with addGuestPass (person, then guest_pass).
 *
 * @param {*} connection
 * @param {{ date: string, start: string, players?: Array }} booking
 */
async function assertGuestsHaveValidPasses(connection, booking) {
    const personIds = personIdsFromPlayers(booking?.players);
    if (personIds.length === 0) {
        return;
    }

    const guests = await findPassRequiringPlayers(
        connection,
        personIds,
        booking.date
    );
    if (guests.length === 0) {
        return;
    }

    const covering = await findCoveringPasses(
        connection,
        guests.map((guest) => guest.id),
        booking.date,
        booking.start
    );

    const missing = guestsMissingCoveringPass(guests, coveredGuestIds(covering));

    const settingsByType = await loadSettingsByPassType(
        connection,
        covering.map((pass) => pass.type),
        { lock: true }
    );

    const restricted = [];

    guests.forEach((guest) => {
        const passes = covering.filter((pass) => pass.guest_id === guest.id);
        if (passes.length === 0) {
            return;
        }

        const settingsList = passes.map((pass) =>
            settingsForPassType(settingsByType, pass.type)
        );
        const allowed = settingsList.some(
            (settings) => evaluatePassRules(settings, booking).ok
        );
        if (allowed) {
            return;
        }

        restricted.push({
            ...guest,
            play_after: earliestPlayAfter(settingsList),
        });
    });

    if (missing.length === 0 && restricted.length === 0) {
        return;
    }

    const parts = [];
    if (missing.length > 0) {
        parts.push(formatMissingGuestPassMessage(missing));
    }
    if (restricted.length > 0) {
        parts.push(formatPlayAfterMessage(restricted));
    }

    log(
        appLogLevels.WARNING,
        `Guest pass missing: ${JSON.stringify({
            booking_date: booking.date,
            booking_start: booking.start,
            guest_ids: missing.map((guest) => guest.id),
            restricted_ids: restricted.map((guest) => guest.id),
        })}`
    );

    throw new RESTError(422, parts.join(" "));
}

module.exports = {
    SETTING_KEY,
    formatMissingGuestPassMessage,
    formatPlayAfterMessage,
    guestsMissingCoveringPass,
    guestsAreUnaccompanied,
    findPassRequiringPlayers,
    findCoveringPasses,
    findGuestsWithCoveringPass,
    isGuestsAccompaniedByMemberRequired,
    assertGuestsAccompaniedByMember,
    assertGuestsHaveValidPasses,
};
