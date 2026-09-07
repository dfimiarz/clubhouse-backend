const { z } = require("zod");

const DEFAULT_SESSION_DURATION_POLICY = Object.freeze(Object.fromEntries([
    [1, 45, 45, 0, 1],
    [2, 60, 30, 2, 2],
    [3, 60, 30, 2, 0],
    [4, 90, 45, 4, 4],
].map(([count, full, reduced, min, max]) => [count, Object.freeze({
    full_duration_min: full,
    reduced_duration_min: reduced,
    full_allotment: Object.freeze({ min_non_repeaters: min, max_second_repeaters: max }),
})])));

const duration = z.number().int().min(5).max(180);
const sessionDurationPolicySchema = z.strictObject(Object.fromEntries(
    [1, 2, 3, 4].map((count) => [count, z.strictObject({
        full_duration_min: duration,
        reduced_duration_min: duration,
        // null means nobody receives the full duration.
        full_allotment: z.strictObject({
            min_non_repeaters: z.number().int().min(0).max(count),
            max_second_repeaters: z.number().int().min(0).max(count),
        }).nullable(),
    }).refine((row) => row.reduced_duration_min <= row.full_duration_min, {
        message: "Reduced duration cannot exceed full duration",
        path: ["reduced_duration_min"],
    })]),
));

module.exports = { DEFAULT_SESSION_DURATION_POLICY, sessionDurationPolicySchema };
