const sqlconnector = require("../db/SqlConnector");
const RESTError = require("../utils/RESTError");
const { personIdsFromPlayers } = require("./playerOverlap");
const { log, appLogLevels } = require("../utils/logger/logger");

const CLUB_ID = process.env.CLUB_ID;

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
const covering_guest_pass_q = `SELECT gp.guest_id
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
 * @param {*} connection
 * @param {number[]} guestIds
 * @param {string} date
 * @param {string} start
 * @returns {Promise<number[]>}
 */
async function findGuestsWithCoveringPass(connection, guestIds, date, start) {
    const rows = await sqlconnector.runQuery(
        connection,
        covering_guest_pass_q,
        [CLUB_ID, [guestIds], CLUB_ID, date, start]
    );

    if (!Array.isArray(rows)) {
        throw new Error("Unable to check guest passes");
    }

    const seen = new Set();
    const covered = [];

    rows.forEach((row) => {
        const id = Number(row.guest_id);
        if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id)) {
            return;
        }
        seen.add(id);
        covered.push(id);
    });

    return covered;
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
 * Reject a guest-only roster. Any non-guest member (or instructor/manager)
 * is enough; they do not need guest_host.
 *
 * @param {*} connection
 * @param {{ date: string, players?: Array }} booking
 */
async function assertGuestsAccompaniedByMember(connection, booking) {
    const personIds = personIdsFromPlayers(booking?.players);
    if (personIds.length === 0) {
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

    const coveredIds = await findGuestsWithCoveringPass(
        connection,
        guests.map((guest) => guest.id),
        booking.date,
        booking.start
    );

    const missing = guestsMissingCoveringPass(guests, coveredIds);
    if (missing.length === 0) {
        return;
    }

    log(
        appLogLevels.WARNING,
        `Guest pass missing: ${JSON.stringify({
            booking_date: booking.date,
            booking_start: booking.start,
            guest_ids: missing.map((guest) => guest.id),
        })}`
    );

    throw new RESTError(422, formatMissingGuestPassMessage(missing));
}

module.exports = {
    formatMissingGuestPassMessage,
    guestsMissingCoveringPass,
    guestsAreUnaccompanied,
    findPassRequiringPlayers,
    findGuestsWithCoveringPass,
    assertGuestsAccompaniedByMember,
    assertGuestsHaveValidPasses,
};
