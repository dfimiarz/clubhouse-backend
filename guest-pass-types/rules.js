const { SETTINGS } = require("./settings");
const { bookingWeekday } = require("./weekdays");

/**
 * @param {unknown} value
 * @returns {number}
 */
function timeToMinutes(value) {
    if (value == null) {
        return NaN;
    }

    const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(value).trim());
    if (!match) {
        return NaN;
    }

    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) {
        return NaN;
    }

    return hours * 60 + minutes;
}

/**
 * @param {unknown} value
 * @returns {string|null}
 */
function formatClock(value) {
    const minutes = typeof value === "number" ? value : timeToMinutes(value);
    if (!Number.isFinite(minutes) || minutes < 0 || minutes > 23 * 60 + 59) {
        return null;
    }

    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

/**
 * @param {unknown} playAfter
 * @param {{ start?: unknown }} booking
 * @returns {{ ok: boolean, key?: string, clock?: string }}
 */
function evaluatePlayAfter(playAfter, booking) {
    if (playAfter == null) {
        return { ok: true };
    }

    const afterMin = timeToMinutes(playAfter);
    if (!Number.isFinite(afterMin)) {
        return { ok: true };
    }

    const clock = formatClock(afterMin);
    const startMin = timeToMinutes(booking?.start);
    if (!Number.isFinite(startMin) || startMin < afterMin) {
        return { ok: false, key: "play_after", clock };
    }

    return { ok: true };
}

/**
 * @param {unknown} allowedDays Resolved ISO weekdays, or null for unrestricted.
 * @param {{ date?: string }} booking
 * @returns {{ ok: boolean, key?: string, day?: number|null }}
 */
function evaluateAllowedDays(allowedDays, booking) {
    if (!Array.isArray(allowedDays)) return { ok: true };
    const day = bookingWeekday(booking?.date);
    return allowedDays.includes(day)
        ? { ok: true }
        : { ok: false, key: "allowed_days", day };
}

// Longest window scanned; seasons are shorter than this.
const MAX_WINDOW_DAYS = 400;

/**
 * Whether a session can still start on some club-local date in [from, to]
 * under these pass settings.
 *
 * A start must fall in an open frame from `openFrames(date)`, at or after
 * play_after, leave `minSessionMin` (default 1) before the frame closes and, on `from`
 * (today), not be before `nowMin`. On `to` it must be at or before
 * `lastStartMin`, since the pass covers a session only when it starts by
 * valid_to.
 *
 * @param {object|null|undefined} resolved
 * @param {{ from: string, to: string, nowMin?: number, lastStartMin?: number, minSessionMin?: number,
 *   openFrames: (date: string) => Array<{ open_min: number, close_min: number }> }} window
 * @returns {boolean}
 */
function hasPlayableTime(resolved, {
    from, to, nowMin = 0, lastStartMin = 24 * 60 - 1, minSessionMin = 1, openFrames,
}) {
    const settings = resolved && typeof resolved === "object" ? resolved : {};
    if (bookingWeekday(from) == null || bookingWeekday(to) == null) return false;

    const afterMin = timeToMinutes(settings.play_after);
    const playAfter = Number.isFinite(afterMin) ? afterMin : 0;

    // UTC arithmetic keeps club-local dates from shifting, as in bookingWeekday.
    const cursor = new Date(`${from}T00:00:00.000Z`);
    for (let i = 0; i < MAX_WINDOW_DAYS; i++) {
        const date = cursor.toISOString().slice(0, 10);
        if (date > to) return false;
        cursor.setUTCDate(cursor.getUTCDate() + 1);

        if (!evaluateAllowedDays(settings.allowed_days, { date }).ok) continue;

        const earliest = Math.max(playAfter, date === from ? nowMin : 0);
        const latest = date === to ? lastStartMin : Infinity;
        const playable = openFrames(date).some((frame) => {
            const start = Math.max(frame.open_min, earliest);
            return start <= latest && start + minSessionMin <= frame.close_min;
        });
        if (playable) return true;
    }
    return false;
}

const EVALUATORS = {
    play_after: evaluatePlayAfter,
    allowed_days: evaluateAllowedDays,
};

/**
 * Walks registered pass rules. A null/missing value is unrestricted.
 *
 * @param {object|null|undefined} resolved
 * @param {{ date?: string, start?: unknown }} booking
 * @returns {{ ok: boolean, key?: string, clock?: string, day?: number|null }}
 */
function evaluatePassRules(resolved, booking) {
    const settings = resolved && typeof resolved === "object" ? resolved : {};

    for (const key of Object.keys(SETTINGS)) {
        const evaluate = EVALUATORS[key];
        if (!evaluate) {
            continue;
        }

        const result = evaluate(settings[key], booking);
        if (!result.ok) {
            return result;
        }
    }

    return { ok: true };
}

/**
 * Earliest play_after among these resolved settings maps (most permissive
 * of a failing set).
 *
 * @param {object[]} settingsList
 * @returns {string|null}
 */
function earliestPlayAfter(settingsList) {
    let earliest = null;

    (Array.isArray(settingsList) ? settingsList : []).forEach((settings) => {
        const clock = formatClock(settings?.play_after);
        if (!clock) {
            return;
        }
        if (earliest == null || timeToMinutes(clock) < timeToMinutes(earliest)) {
            earliest = clock;
        }
    });

    return earliest;
}

module.exports = {
    timeToMinutes,
    formatClock,
    evaluatePassRules,
    evaluatePlayAfter,
    evaluateAllowedDays,
    earliestPlayAfter,
    hasPlayableTime,
};
