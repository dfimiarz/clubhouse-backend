const { z } = require("zod");

// ISO weekdays: Monday = 1 through Sunday = 7.
const WEEKDAY_NAMES = [
    "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
];

const allowedDaysSchema = z.array(z.number().int().min(1).max(7))
    .min(1, "Select at least one playing day")
    .max(7)
    .refine((days) => new Set(days).size === days.length, "Playing days must be unique")
    // Canonicalize on both API writes and stored-setting reads.
    .transform((days) => days.length === 7 ? null : [...days].sort((a, b) => a - b));

function bookingWeekday(date) {
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    // The date is already club-local. UTC arithmetic avoids shifting it to
    // the server's timezone, including across daylight-saving transitions.
    const parsed = new Date(`${date}T00:00:00.000Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return null;
    return parsed.getUTCDay() || 7;
}

module.exports = { WEEKDAY_NAMES, allowedDaysSchema, bookingWeekday };
