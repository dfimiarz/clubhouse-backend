const sqlconnector = require("../db/SqlConnector");
const settingsReader = require("./settingsReader");
const { sessionDurationPolicySchema } = require("./sessionDurationPolicy");

const SETTING_KEY = "session_duration_policy";
const CLUB_ID = process.env.CLUB_ID;

/** Read fresh settings, reusing the booking transaction when one is supplied. */
async function getSessionDurationPolicy(connection) {
    return (await settingsReader.readClubSettings(connection ?? null, [SETTING_KEY]))[SETTING_KEY];
}

async function saveSessionDurationPolicy(policy) {
    const validated = sessionDurationPolicySchema.parse(policy);
    await sqlconnector.withConnection((connection) => sqlconnector.runExecute(connection,
        `INSERT INTO club_setting (club, setting_key, setting_value) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
        [CLUB_ID, SETTING_KEY, JSON.stringify(validated)]));
    return validated;
}

module.exports = { getSessionDurationPolicy, saveSessionDurationPolicy };
