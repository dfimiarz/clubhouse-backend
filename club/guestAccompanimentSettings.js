const { z } = require("zod");
const sqlconnector = require("../db/SqlConnector");
const settingsReader = require("./settingsReader");

const SETTING_KEY = "require_guests_accompanied_by_member";
const CLUB_ID = process.env.CLUB_ID;

async function getGuestAccompaniment() {
    return (await settingsReader.readClubSettings(null, [SETTING_KEY]))[SETTING_KEY];
}

async function saveGuestAccompaniment(required) {
    const validated = z.boolean().parse(required);
    await sqlconnector.withConnection((connection) => sqlconnector.runExecute(connection,
        `INSERT INTO club_setting (club, setting_key, setting_value) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
        [CLUB_ID, SETTING_KEY, validated ? "1" : "0"]));
    return validated;
}

module.exports = { getGuestAccompaniment, saveGuestAccompaniment };
