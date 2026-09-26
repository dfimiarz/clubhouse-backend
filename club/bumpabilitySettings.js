const sqlconnector = require("../db/SqlConnector");
const settingsReader = require("./settingsReader");
const { bumpabilityPolicySchema } = require("./bumpabilityPolicy");

const SETTING_KEY = "bumpability_policy";
const CLUB_ID = process.env.CLUB_ID;

/** Read directly, reusing the booking transaction when supplied; bypass Redis. */
async function getBumpabilityPolicy(connection) {
    return (await settingsReader.readClubSettings(connection ?? null, [SETTING_KEY]))[SETTING_KEY];
}

async function saveBumpabilityPolicy(policy) {
    const validated = bumpabilityPolicySchema.parse(policy);
    await sqlconnector.withConnection((connection) => sqlconnector.runExecute(connection,
        `INSERT INTO club_setting (club, setting_key, setting_value) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
        [CLUB_ID, SETTING_KEY, validated]));
    return validated;
}

module.exports = { getBumpabilityPolicy, saveBumpabilityPolicy };
