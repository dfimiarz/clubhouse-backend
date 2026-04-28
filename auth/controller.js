const { v4: uuidv4 } = require('uuid');
const { getClient } = require('./../db/RedisConnector')
const svgCaptcha = require('svg-captcha')
const RESTError = require('./../utils/RESTError');
const sqlconnector = require('../db/SqlConnector');

const EXP_TIME = 60; //Capcha expired in 120 seconds
const USED_HCAPTCHA_TOKENS = new Map();
const HCAPTCHA_TOKEN_TTL_MS = 2 * 60 * 1000;

/**
 * 
 * @returns { Object } Captch params
 */
async function getCaptcha() {

    const captcha = svgCaptcha.create({ size: 5, noise: 2 });
    const requestid = uuidv4();
    const text = captcha.text;


    await getClient().set(requestid, text, {
        EX: EXP_TIME,
        NX: true
    });

    return { svg: encodeURIComponent(captcha.data), reqid: requestid }

}

async function verifyCaptcha(requestid, text) {

    const res = await getClient().get(requestid);

    if (!res) {
        throw new RESTError(422,{ fielderrors: [{ param: "captcha", msg: "Captcha expired"}]});
    }

    return res === text

}

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

    //set up connection and query
    const connection = await sqlconnector.getConnection()
    const query = `SELECT r.id,r.lbl FROM clubhouse.membership m join person p on p.id = m.person_id join role r on r.id = m.role join club c on c.id = p.club where club = ? and convert_tz(CURDATE(),@@GLOBAL.time_zone,c.time_zone) between valid_from AND valid_until and p.email = ?`;

    //Get role from the database
    try {

        const role_result = await sqlconnector.runQuery(connection, query, [club_id, username]);

        if (!Array.isArray(role_result) || role_result.length > 1) {
            throw new Error("Unexpected Result");
        }

        return role_result.length === 1 ? role_result[0].id : null;

    }
    finally {
        connection.release();
    }


}

/**
 * TO DO: Move to a separate file
 */

async function verifyhCaptcha(token, options = {}) {
    purgeExpiredHcaptchaTokens();

    if (USED_HCAPTCHA_TOKENS.has(token)) {
        return {
            success: false,
            replayed: true,
            hostname: null,
            hostnameValid: false,
        };
    }

    const secret = process.env.HCAPTCHA_SECRET_KEY;
    const expectedHostnames = getAllowedHCaptchaHostnames();

    const url = `https://hcaptcha.com/siteverify`;

    const data = { secret, response: token };

    if (options.remoteip) {
        data.remoteip = options.remoteip;
    }

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams(data)
    });

    const result = await response.json();
    console.log("hCaptcha verification result:", result);
    const normalizedHostname = typeof result.hostname === "string"
        ? result.hostname.toLowerCase()
        : null;

    const hostnameValid = expectedHostnames.length === 0
        ? true
        : !!normalizedHostname && expectedHostnames.includes(normalizedHostname);
    const success = result.success === true && hostnameValid;

    if (success) {
        USED_HCAPTCHA_TOKENS.set(token, Date.now() + HCAPTCHA_TOKEN_TTL_MS);
    }

    return {
        success,
        replayed: false,
        hostname: result.hostname || null,
        hostnameValid,
    };

}

function purgeExpiredHcaptchaTokens() {
    const now = Date.now();

    for (const [token, expiresAt] of USED_HCAPTCHA_TOKENS.entries()) {
        if (expiresAt <= now) {
            USED_HCAPTCHA_TOKENS.delete(token);
        }
    }
}

function getAllowedHCaptchaHostnames() {
    const configured = process.env.HCAPTCHA_ALLOWED_HOSTNAMES;

    if (!configured) {
        return ["localhost", "clubhouse.test"];
    }

    return configured
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => {
            if (/^https?:\/\//i.test(entry)) {
                return new URL(entry).hostname.toLowerCase();
            }

            return entry
                .replace(/^https?:\/\//i, "")
                .split("/")[0]
                .split(":")[0]
                .toLowerCase();
        });
}

function _resetUsedHCaptchaTokens() {
    USED_HCAPTCHA_TOKENS.clear();
}


module.exports = {
    getCaptcha,
    verifyCaptcha,
    getUserRole,
    verifyhCaptcha,
    getAllowedHCaptchaHostnames,
    _resetUsedHCaptchaTokens,
}
