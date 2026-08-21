/**
 * Registry of per-guest-pass-type rules.
 *
 * Values are stored as strings in `guest_pass_type_setting`, but the keys,
 * types and defaults live here so adding a rule costs one entry and no
 * migration. A type with no row for a key gets the default (unrestricted).
 *
 * Overriding a setting for a pass type:
 *   INSERT INTO guest_pass_type_setting (pass_type, setting_key, setting_value)
 *   VALUES (<type id>, '<key>', '<value>')
 *   ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value);
 */

const sqlconnector = require("../db/SqlConnector");
const { resolveSettings } = require("../club/settings");

const SETTINGS = {
    // Opt-in: session start must be at or after this club-local time.
    play_after: {
        type: "time",
        default: null,
        public: true,
        label: "Play at or after",
    },
};

const SETTINGS_FOR_TYPES_Q = `SELECT pass_type, setting_key, setting_value
                              FROM guest_pass_type_setting
                              WHERE pass_type IN ?`;

const SETTINGS_FOR_TYPE_Q = `SELECT pass_type, setting_key, setting_value
                             FROM guest_pass_type_setting
                             WHERE pass_type = ?`;

const SETTINGS_FOR_CLUB_Q = `SELECT gps.pass_type, gps.setting_key, gps.setting_value
                             FROM guest_pass_type_setting gps
                             JOIN guest_pass_type gpt ON gpt.id = gps.pass_type
                             WHERE gpt.club_id = ?`;

/**
 * @param {unknown[]} typeIds
 * @returns {number[]}
 */
function uniqueTypeIds(typeIds) {
    const seen = new Set();
    const ids = [];

    (Array.isArray(typeIds) ? typeIds : []).forEach((raw) => {
        const id = Number(raw);
        if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id)) {
            return;
        }
        seen.add(id);
        ids.push(id);
    });

    return ids;
}

/**
 * @param {string} query
 * @param {boolean} lock
 * @returns {string}
 */
function maybeLock(query, lock) {
    return lock ? `${query}\nLOCK IN SHARE MODE` : query;
}

/**
 * @param {Array<{setting_key: string, setting_value: string}>} rows
 * @returns {object}
 */
function resolvePassTypeSettings(rows) {
    return resolveSettings(rows, { registry: SETTINGS, publicOnly: false });
}

/**
 * @param {string} key
 * @param {{ type?: string, default?: unknown, label?: string }} definition
 * @param {unknown} value
 * @returns {string|null}
 */
function formatConstraintText(key, definition, value) {
    if (value === undefined || value === null || Object.is(value, definition.default)) {
        return null;
    }

    const label =
        typeof definition.label === "string" && definition.label.trim()
            ? definition.label.trim()
            : key;

    switch (definition.type) {
        case "boolean":
            return value ? label : null;
        case "time":
        case "int":
        case "string":
            return `${label} ${value}`;
        default:
            return `${label} ${value}`;
    }
}

/**
 * Display rows for every resolved value that is not the unrestricted default.
 *
 * @param {object|null|undefined} resolved
 * @returns {Array<{ key: string, text: string }>}
 */
function constraintsFromSettings(resolved) {
    const settings = resolved && typeof resolved === "object" ? resolved : {};
    const constraints = [];

    Object.entries(SETTINGS).forEach(([key, definition]) => {
        const text = formatConstraintText(key, definition, settings[key]);
        if (text) {
            constraints.push({ key, text });
        }
    });

    return constraints;
}

/**
 * Payload the app uses to label a type: raw settings plus display rows.
 *
 * @param {object|null|undefined} resolved
 * @returns {{ settings: object, constraints: Array<{ key: string, text: string }> }}
 */
function passTypeRules(resolved) {
    const settings =
        resolved && typeof resolved === "object" && !Array.isArray(resolved)
            ? resolved
            : resolvePassTypeSettings([]);

    return {
        settings,
        constraints: constraintsFromSettings(settings),
    };
}

/**
 * @param {Array<{pass_type?: unknown, setting_key: string, setting_value: string}>} rows
 * @returns {Map<number, object>}
 */
function resolveSettingsByPassType(rows) {
    const grouped = new Map();

    (Array.isArray(rows) ? rows : []).forEach((row) => {
        const typeId = Number(row?.pass_type);
        if (!Number.isSafeInteger(typeId) || typeId <= 0) {
            return;
        }
        if (!grouped.has(typeId)) {
            grouped.set(typeId, []);
        }
        grouped.get(typeId).push(row);
    });

    const resolved = new Map();
    grouped.forEach((typeRows, typeId) => {
        resolved.set(typeId, resolvePassTypeSettings(typeRows));
    });
    return resolved;
}

/**
 * @param {Map<number, object>|null|undefined} settingsByType
 * @param {unknown} typeId
 * @returns {object}
 */
function settingsForPassType(settingsByType, typeId) {
    const id = Number(typeId);
    if (settingsByType instanceof Map && Number.isSafeInteger(id) && settingsByType.has(id)) {
        return settingsByType.get(id);
    }
    return resolvePassTypeSettings([]);
}

/**
 * @param {Map<number, object>|null|undefined} settingsByType
 * @param {unknown} typeId
 * @returns {{ settings: object, constraints: Array<{ key: string, text: string }> }}
 */
function rulesForPassType(settingsByType, typeId) {
    return passTypeRules(settingsForPassType(settingsByType, typeId));
}

/**
 * @param {*} connection
 * @param {unknown[]} typeIds
 * @param {{ lock?: boolean }} [options]
 * @returns {Promise<Map<number, object>>}
 */
async function loadSettingsByPassType(connection, typeIds, { lock = false } = {}) {
    const ids = uniqueTypeIds(typeIds);
    if (ids.length === 0) {
        return new Map();
    }

    const rows = await sqlconnector.runQuery(
        connection,
        maybeLock(SETTINGS_FOR_TYPES_Q, lock),
        [[ids]]
    );

    if (!Array.isArray(rows)) {
        throw new Error("Unable to read guest pass type settings");
    }

    return resolveSettingsByPassType(rows);
}

/**
 * @param {*} connection
 * @param {unknown} typeId
 * @param {{ lock?: boolean }} [options]
 * @returns {Promise<object>}
 */
async function loadSettingsForPassType(connection, typeId, { lock = false } = {}) {
    const id = Number(typeId);
    if (!Number.isSafeInteger(id) || id <= 0) {
        return resolvePassTypeSettings([]);
    }

    const query = lock ? `${SETTINGS_FOR_TYPE_Q}\nLOCK IN SHARE MODE` : SETTINGS_FOR_TYPE_Q;
    const rows = await sqlconnector.runQuery(connection, query, [id]);

    if (!Array.isArray(rows)) {
        throw new Error("Unable to read guest pass type settings");
    }

    return resolvePassTypeSettings(rows);
}

/**
 * @param {*} connection
 * @param {unknown} clubId
 * @returns {Promise<Map<number, object>>}
 */
async function loadClubPassTypeSettings(connection, clubId) {
    const rows = await sqlconnector.runQuery(connection, SETTINGS_FOR_CLUB_Q, [clubId]);

    if (!Array.isArray(rows)) {
        throw new Error("Unable to read guest pass type settings");
    }

    return resolveSettingsByPassType(rows);
}

module.exports = {
    SETTINGS,
    resolvePassTypeSettings,
    resolveSettingsByPassType,
    settingsForPassType,
    constraintsFromSettings,
    passTypeRules,
    rulesForPassType,
    loadSettingsByPassType,
    loadSettingsForPassType,
    loadClubPassTypeSettings,
};
