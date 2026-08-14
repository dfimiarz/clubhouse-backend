/**
 * Registry of product analytics events.
 *
 * Rows in `app_event` are data only: the event names and the shape of each
 * event's `props` live here, so adding an event costs one entry below and no
 * migration. The same idea as club/settings.js.
 *
 * Adding an event:
 *   1. add an entry to EVENTS with a zod schema for its props
 *   2. call trackEvent(<name>, <props>) from the client at the moment it happens
 *   3. if it needs a report, add a processor in reports/reportProcessors.js
 *
 * Schemas are strict: an unexpected key is a 400 rather than a silently stored
 * field, which keeps the JSON column readable months later and makes a typo in
 * a call site show up immediately instead of as a column nobody can query.
 */

const { z } = require("zod");

/**
 * People an event is about. Kept in props rather than a link table so that
 * deleting a member cannot cascade away past events and rewrite history.
 */
const personIds = z.array(z.number().int().positive()).min(1).max(8);

const personId = z.number().int().positive();

/** Minutes from midnight; the booking code works in this unit throughout. */
const minuteOfDay = z.number().int().min(0).max(1439);

/** Player slot index on the match booking form (0–3). */
const slotIndex = z.number().int().min(0).max(3);

/** Booking stepper step (1 players, 2 court/time, 3 confirm). */
const bookingStep = z.number().int().min(1).max(3);

/**
 * Duration in minutes. Upper bound is a full day rather than the picker's 180
 * cap: auto-seeded / rule defaults can exceed the picker absolute max when
 * club rules allow a longer preferred session.
 */
const durationMin = z.number().int().min(0).max(1440);

const positiveInt = z.number().int().positive();

const EVENTS = {
    // --- Match booking funnel (flow_id = one booking screen session) ---

    // Screen opened. prefilled_player_count is route/query prefill only — those
    // players are not emitted as booking_player_set.
    booking_started: {
        props: z
            .object({
                prefilled_player_count: z.number().int().min(0).max(4),
            })
            .strict(),
    },
    // Player dialog Save (add or edit of a slot).
    booking_player_set: {
        props: z
            .object({
                person_id: personId,
                player_type: positiveInt,
                slot_index: slotIndex,
            })
            .strict(),
    },
    booking_player_removed: {
        props: z
            .object({
                person_id: personId,
                slot_index: slotIndex,
            })
            .strict(),
    },
    // Clear-all with at least one player present. Empty clear is not recorded.
    booking_players_cleared: {
        props: z.object({ person_ids: personIds }).strict(),
    },
    booking_activity_selected: {
        props: z.object({ activity_type: positiveInt }).strict(),
    },
    booking_court_selected: {
        props: z.object({ court_id: positiveInt }).strict(),
    },
    // Duration dialog OK only — not intermediate numberpad keys or setMatchParams.
    booking_duration_selected: {
        props: z
            .object({
                duration_min: durationMin,
                preferred_min: durationMin.nullable(),
            })
            .strict(),
    },
    // User toggle on the bumpable switch only — not reqBumpable auto-sync.
    booking_bumpable_set: {
        props: z.object({ bumpable: z.boolean() }).strict(),
    },
    // Successful continue past validation (not failed attempts).
    booking_step_continued: {
        props: z
            .object({
                from_step: bookingStep,
                to_step: bookingStep,
            })
            .strict(),
    },
    // Successful POST /bookings. Snapshot of what was submitted (no note).
    booking_completed: {
        props: z
            .object({
                person_ids: personIds,
                player_types: z.array(positiveInt).min(1).max(8),
                court_id: positiveInt,
                activity_type: positiveInt,
                start_min: minuteOfDay,
                duration_min: durationMin,
                bumpable: z.boolean(),
            })
            .strict(),
    },

    // --- Rebooking (same flow_id as the booking session when available) ---

    // The back-to-back dialog was shown. One per dialog actually rendered, so
    // this is the denominator for the accept rate.
    rebooking_offered: {
        props: z
            .object({
                person_ids: personIds,
                minutes_ago: z.number().int().nonnegative(),
                start_min: minuteOfDay,
            })
            .strict(),
    },
    // The user confirmed with "continue from the previous session" selected.
    rebooking_accepted: {
        props: z.object({ person_ids: personIds, start_min: minuteOfDay }).strict(),
    },
    // The user confirmed with "starting now" selected.
    rebooking_declined: {
        props: z.object({ person_ids: personIds, start_min: minuteOfDay }).strict(),
    },
    // An accepted offer turned into a real booking. Separates "clicked yes"
    // from "finished the flow", and records whether the suggested time
    // survived: the user can still edit the start time afterwards, so an
    // accepted offer does not mean the booking used it. start_min is what was
    // actually booked, so the gap from offered_start_min shows how far off the
    // suggestion was. An accepted offer with no such event was abandoned.
    rebooking_booked: {
        props: z
            .object({
                person_ids: personIds,
                start_min: minuteOfDay,
                offered_start_min: minuteOfDay,
                kept_offer: z.boolean(),
            })
            .strict(),
    },
    // Court-step start-time menu pick (After last session / Now / +5 / Other).
    // Not rebooking-only: Now / +5 / Other fire even when the prompt is off.
    // option ids match the frontend startTimeOptions ids.
    start_time_option_selected: {
        props: z
            .object({
                option: z.enum(["rebooking", "now", "plus5", "other"]),
                start_min: minuteOfDay,
            })
            .strict(),
    },

    // Booking Details Fast rebook confirmed and POST /bookings succeeded.
    // Separate from the form prompt (rebooking_*): no offer/accept step.
    // source_booking_id is the ended session the follow-on continues from.
    fast_rebook_completed: {
        props: z
            .object({
                source_booking_id: positiveInt,
                person_ids: personIds,
                player_types: z.array(positiveInt).min(1).max(8),
                court_id: positiveInt,
                activity_type: positiveInt,
                start_min: minuteOfDay,
                duration_min: durationMin,
                bumpable: z.boolean(),
            })
            .strict(),
    },
};

/**
 * @returns {Array<string>} every known event name
 */
function getEventNames() {
    return Object.keys(EVENTS);
}

/**
 * @param {string} name
 * @returns {{props: import('zod').ZodType}|null} null when the name is unknown
 */
function getEventDefinition(name) {
    return Object.prototype.hasOwnProperty.call(EVENTS, name) ? EVENTS[name] : null;
}

module.exports = { EVENTS, getEventNames, getEventDefinition };
