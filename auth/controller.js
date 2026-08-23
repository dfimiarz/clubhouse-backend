const crypto = require('node:crypto');
const redisconnector = require('./../db/RedisConnector');
const sqlconnector = require('../db/SqlConnector');
const { log, appLogLevels } = require('./../utils/logger/logger');

const HCAPTCHA_TOKEN_TTL_SECONDS = 2 * 60;
const DEV_HCAPTCHA_HOSTNAMES = ["localhost", "clubhouse.test"];

/**
 * 
 * @param {String} username Usernmae
 * @param {Number} club_id ClubID
 * @returns {Promise<Number>} Role for a given user
 */
async function getUserRole(username, club_id) {

    if (!username) {
        return null;
    }

    const query = `SELECT r.id,r.lbl FROM clubhouse.membership m join person p on p.id = m.person_id join role r on r.id = m.role join club c on c.id = p.club where club = ? and convert_tz(CURDATE(),@@GLOBAL.time_zone,c.time_zone) between valid_from AND valid_until and p.email = ?`;

    // Prepared statement — hot path, scalar binds only
    return sqlconnector.withConnection(async (connection) => {
        const role_result = await sqlconnector.runExecute(connection, query, [club_id, username]);

        if (!Array.isArray(role_result) || role_result.length > 1) {
            throw new Error("Unexpected Result");
        }

        return role_result.length === 1 ? role_result[0].id : null;
    });
}

function isProduction(env) {
    return (env.NODE_ENV || "").trim().toLowerCase() === "production";
}

function hostnameFromAllowlistEntry(entry) {
    try {
        if (/^https?:\/\//i.test(entry)) {
            return new URL(entry).hostname.toLowerCase();
        }

        return entry
            .replace(/^https?:\/\//i, "")
            .split("/")[0]
            .split(":")[0]
            .toLowerCase();
    } catch {
        return null;
    }
}

/**
 * Hostnames hCaptcha may report for a solved widget.
 *
 * Production with an empty/invalid list returns [] so the hostname check
 * rejects rather than skipping. Dev falls back to local widget hosts when
 * the env var is unset or parses to nothing.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]}
 */
function getAllowedHCaptchaHostnames(env = process.env) {
    const parsed = [];

    for (const entry of (env.HCAPTCHA_ALLOWED_HOSTNAMES || "").split(",")) {
        const hostname = hostnameFromAllowlistEntry(entry.trim());
        if (hostname && !parsed.includes(hostname)) {
            parsed.push(hostname);
        }
    }

    if (parsed.length > 0) {
        return parsed;
    }

    if (isProduction(env)) {
        log(
            appLogLevels.ERROR,
            "HCAPTCHA_ALLOWED_HOSTNAMES is empty in production; rejecting all captcha hostnames"
        );
        return [];
    }

    return DEV_HCAPTCHA_HOSTNAMES;
}

function usedHcaptchaKey(token) {
    const hash = crypto.createHash("sha256").update(String(token)).digest("hex");
    return `hcaptcha:used:${hash}`;
}

/**
 * Atomically claim a token in Redis so two instances cannot both pass
 * siteverify. NX miss is a replay; Redis errors fail closed (token unused
 * at hCaptcha, caller must solve a new challenge).
 *
 * @param {string} token
 * @returns {Promise<"ok"|"replayed"|"unavailable">}
 */
async function claimHcaptchaToken(token) {
    try {
        const stored = await redisconnector.getClient().set(
            usedHcaptchaKey(token),
            "1",
            {
                EX: HCAPTCHA_TOKEN_TTL_SECONDS,
                NX: true,
            }
        );

        return stored === "OK" ? "ok" : "replayed";
    } catch (error) {
        log(appLogLevels.WARNING, `hCaptcha replay store failed: ${error}`);
        return "unavailable";
    }
}

/**
 * @param {string} token
 * @param {{ remoteip?: string, env?: NodeJS.ProcessEnv }} [options]
 */
async function verifyhCaptcha(token, options = {}) {
    if (!token) {
        return {
            success: false,
            replayed: false,
            hostname: null,
            hostnameValid: false,
        };
    }

    const claim = await claimHcaptchaToken(token);

    if (claim === "replayed") {
        return {
            success: false,
            replayed: true,
            hostname: null,
            hostnameValid: false,
        };
    }

    if (claim !== "ok") {
        return {
            success: false,
            replayed: false,
            hostname: null,
            hostnameValid: false,
        };
    }

    const expectedHostnames = getAllowedHCaptchaHostnames(options.env || process.env);

    if (expectedHostnames.length === 0) {
        return {
            success: false,
            replayed: false,
            hostname: null,
            hostnameValid: false,
        };
    }

    const secret = process.env.HCAPTCHA_SECRET_KEY;

    const data = { secret, response: token };

    if (options.remoteip) {
        data.remoteip = options.remoteip;
    }

    const response = await fetch("https://hcaptcha.com/siteverify", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(data),
    });

    const result = await response.json();
    const normalizedHostname = typeof result.hostname === "string"
        ? result.hostname.toLowerCase()
        : null;

    // Empty allow-list never means "skip": a token is valid only when the
    // reported hostname is on a non-empty list.
    const hostnameValid = expectedHostnames.length > 0
        && !!normalizedHostname
        && expectedHostnames.includes(normalizedHostname);
    const success = result.success === true && hostnameValid;

    return {
        success,
        replayed: false,
        hostname: result.hostname || null,
        hostnameValid,
    };
}

module.exports = {
    getUserRole,
    verifyhCaptcha,
    getAllowedHCaptchaHostnames,
}
