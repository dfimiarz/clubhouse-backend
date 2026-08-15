const { SETTINGS } = require("./settings");

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

const EVALUATORS = {
    play_after: evaluatePlayAfter,
};

/**
 * Walks registered pass rules. A null/missing value is unrestricted.
 *
 * @param {object|null|undefined} resolved
 * @param {{ start?: unknown }} booking
 * @returns {{ ok: boolean, key?: string, clock?: string }}
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
    earliestPlayAfter,
};
