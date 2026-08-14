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
 * The GET /club payload is cached in Redis with no TTL, so any change to a
 * club_setting row needs `yarn cache:clear` before it takes effect.
 */

const SETTINGS = {
    // Opt-in: a club sees the prompt only after setting this to '1'.
    rebooking_prompt_enabled: {
        type: "boolean",
        default: false,
        public: true,
        label: "Show back-to-back rebooking prompt",
    },
    // Opt-in: when on, a person cannot sit on two member-group sessions
    // (activity_group = 1) at the same time. Club sessions are unaffected.
    prevent_concurrent_member_bookings: {
        type: "boolean",
        default: false,
        public: true,
        label: "Prevent overlapping member bookings for the same player",
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
