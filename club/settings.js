/**
 * Registry of per-club settings.
 *
 * Values are stored as strings in the `club_setting` table, but the keys,
 * types, defaults and visibility live here so that adding a setting costs one
 * entry below and no migration. A club with no row for a key gets the default.
 *
 * Adding a setting:
 *   1. add an entry to SETTINGS with a type, a default and a `public` flag
 *   2. read it where it is needed (public ones arrive in the GET /club payload)
 *
 * Overriding a setting for a club:
 *   INSERT INTO club_setting (club, setting_key, setting_value)
 *   VALUES (<club id>, '<key>', '<value>')
 *   ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value);
 *
 * getClubInfo is cached in Redis with no TTL, so public setting changes
 * need `yarn cache:clear` to refresh GET /club. Session duration policies
 * are private and read directly from the database for every request.
 */

const { DEFAULT_SESSION_DURATION_POLICY, sessionDurationPolicySchema } = require("./sessionDurationPolicy");

const SETTINGS = {
    session_duration_policy: {
        type: "json",
        default: DEFAULT_SESSION_DURATION_POLICY,
        schema: sessionDurationPolicySchema,
        public: false,
        label: "Member session durations",
    },
    // Opt-in: a club sees the prompt only after setting this to '1'.
    rebooking_prompt_enabled: {
        type: "boolean",
        default: false,
        public: true,
        label: "Show back-to-back rebooking prompt",
    },
    // On by default: a person cannot have two open member-group sessions
    // (activity_group = 1) — overlapping, still upcoming on the same date,
    // or still in progress (including after midnight). Ended sessions do
    // not block a repeater booking. Club sessions are unaffected. Opt out
    // per club with '0'.
    prevent_concurrent_member_bookings: {
        type: "boolean",
        default: true,
        public: true,
        label: "Prevent a player from having more than one open member booking on the same day",
    },
    // On by default: a guest-only roster is rejected unless the club opts out.
    require_guests_accompanied_by_member: {
        type: "boolean",
        default: true,
        public: true,
        label: "Require a member on bookings that include a guest",
    },
};

/**
 * Turns a stored string into the type the setting declares. Anything the type
 * cannot make sense of falls back to the default, so a bad row degrades to
 * standard behavior instead of breaking the read.
 */
function coerce(definition, rawValue) {
    if (rawValue === null || rawValue === undefined) {
        return definition.default;
    }

    const value = String(rawValue).trim();

    switch (definition.type) {
        case "json": {
            if (!definition.schema) return definition.default;
            try {
                const parsed = definition.schema.safeParse(JSON.parse(value));
                if (parsed.success) return parsed.data;
            } catch { /* JSON.parse throws on malformed value */ }
            const { log, appLogLevels } = require("../utils/logger/logger");
            log(appLogLevels.WARNING, `Invalid ${definition.label || "JSON setting"}; using defaults`);
            return definition.default;
        }
        case "boolean": {
            const lowered = value.toLowerCase();
            if (lowered === "1" || lowered === "true") {
                return true;
            }
            if (lowered === "0" || lowered === "false") {
                return false;
            }
            return definition.default;
        }
        case "int": {
            const parsed = Number.parseInt(value, 10);
            return Number.isNaN(parsed) ? definition.default : parsed;
        }
        case "string":
            return value;
        case "time": {
            const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value);
            if (!match) {
                return definition.default;
            }
            const hours = Number(match[1]);
            const minutes = Number(match[2]);
            const seconds = Number(match[3] ?? 0);
            if (hours > 23 || minutes > 59 || seconds > 59) {
                return definition.default;
            }
            return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
        }
        default:
            return definition.default;
    }
}

/**
 * Merges club_setting rows over the registry defaults.
 *
 * @param {Array<{setting_key: string, setting_value: string}>} rows
 * @param {{publicOnly?: boolean, registry?: object}} options
 * @returns {object} every in-scope key with a typed value
 */
function resolveSettings(rows, { publicOnly = true, registry = SETTINGS } = {}) {
    const overrides = new Map();

    if (Array.isArray(rows)) {
        rows.forEach((row) => {
            overrides.set(row["setting_key"], row["setting_value"]);
        });
    }

    const resolved = {};

    Object.entries(registry).forEach(([key, definition]) => {
        if (publicOnly && !definition.public) {
            return;
        }

        resolved[key] = overrides.has(key)
            ? coerce(definition, overrides.get(key))
            : definition.default;
    });

    return resolved;
}

module.exports = { SETTINGS, coerce, resolveSettings };
