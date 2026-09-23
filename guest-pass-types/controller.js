const sqlconnector = require("../db/SqlConnector");
const club_id = process.env.CLUB_ID;
const RESTError = require("../utils/RESTError");
const {
  SETTINGS,
  loadClubPassTypeSettings,
  loadSettingsForPassType,
  rulesForPassType,
  settingsForPassType,
  passTypeRules,
} = require("./settings");
const { passTypeSchema } = require("./validation");
const { NO_SEASON_REASON, loadSaleContext, evaluateSale } = require("./sale");
const redisconnector = require("../db/RedisConnector");
const { log, appLogLevels } = require("../utils/logger/logger");

/**
 * @typedef {import("./types").PassType} PassType;
 */

/**
 * Why each pass type cannot be sold right now (null when it can), keyed by
 * type id. Uses the same evaluation as POST /guest_passes.
 *
 * @param {*} connection
 * @param {Array<{ id: number, label: string, valid_days: number }>} passTypes
 * @param {Map<number, object>} settingsByType
 * @returns {Promise<Map<number, string|null>>}
 */
async function saleAvailability(connection, passTypes, settingsByType) {
  const sale = await loadSaleContext(connection, club_id);
  return new Map(passTypes.map((passType) => [
    passType.id,
    sale
      ? evaluateSale(sale, passType, settingsForPassType(settingsByType, passType.id)).reason
      : NO_SEASON_REASON,
  ]));
}

/**
 *
 * @returns {Promise<Array<PassType>>}
 */
const getPassTypes = async () => {
  const guest_pass_types_q = `
        SELECT 
            id,
            club_id,
            label,
            valid_days,
            season_limit,
            cost
        FROM 
            guest_pass_type
        WHERE 
            club_id = ?
        ORDER BY label, id`;

  return sqlconnector.withConnection(async (connection) => {
    const guest_pass_types_res = await sqlconnector.runExecute(
      connection,
      guest_pass_types_q,
      [club_id]
    );

    if (
      !Array.isArray(guest_pass_types_res)
    ) {
      throw new RESTError(400, "Failed loading guest pass types");
    }

    const settingsByType = await loadClubPassTypeSettings(connection, club_id);
    // Availability only helps the buy dialog, and POST /guest_passes re-checks
    // it, so a failure here must not take down the catalog (admin settings
    // use it too). Types are then listed without the sale fields.
    let availability = null;
    try {
      availability = await saleAvailability(connection, guest_pass_types_res, settingsByType);
    } catch (error) {
      log(appLogLevels.WARNING, `Unable to evaluate guest pass availability: ${error}`);
    }

    return guest_pass_types_res.map((pass_type) => {
      const entry = {
        id: pass_type.id,
        label: pass_type.label,
        valid: pass_type.valid_days,
        limit: pass_type.season_limit,
        cost: pass_type.cost,
        ...rulesForPassType(settingsByType, pass_type.id),
      };
      if (!availability) return entry;
      const unavailable_reason = availability.get(pass_type.id);
      return { ...entry, sellable: unavailable_reason === null, unavailable_reason };
    });
  });
};

async function savePassType(id, input) {
  const data = passTypeSchema.parse(input);
  const updating = id !== null;
  const result = await sqlconnector.withTransaction(async (connection) => {
    if (id !== null) {
      const rows = await sqlconnector.runExecute(connection,
        "SELECT id FROM guest_pass_type WHERE id = ? AND club_id = ? FOR UPDATE",
        [id, club_id]);
      if (rows.length !== 1) throw new RESTError(404, "Guest pass type not found");
      await sqlconnector.runExecute(connection,
        `UPDATE guest_pass_type SET label = ?, cost = ?, valid_days = ?, season_limit = ?
         WHERE id = ? AND club_id = ?`,
        [data.label, data.cost, data.valid, data.limit, id, club_id]);
    } else {
      const result = await sqlconnector.runExecute(connection,
        `INSERT INTO guest_pass_type (club_id, label, cost, valid_days, season_limit)
         VALUES (?, ?, ?, ?, ?)`,
        [club_id, data.label, data.cost, data.valid, data.limit]);
      id = result.insertId;
    }

    for (const [key, value] of Object.entries(data.settings)) {
      // Older clients may omit new rules; retain those existing settings.
      if (value === undefined) continue;
      if (value === null) {
        await sqlconnector.runExecute(connection,
          "DELETE FROM guest_pass_type_setting WHERE pass_type = ? AND setting_key = ?",
          [id, key]);
      } else {
        await sqlconnector.runExecute(connection,
          `INSERT INTO guest_pass_type_setting (pass_type, setting_key, setting_value)
           VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
          [id, key, SETTINGS[key].type === "json" ? JSON.stringify(value) : value]);
      }
    }
    return { id, ...data, ...passTypeRules(await loadSettingsForPassType(connection, id)) };
  });
  // Active-person responses embed pass labels and restrictions. Invalidate
  // after commit; the existing short TTL bounds staleness if Redis is down.
  if (updating) {
    try {
      await redisconnector.deleteKey(`active_persons_${club_id}`);
    } catch (error) {
      log(appLogLevels.WARNING, `Error invalidating active persons cache: ${error}`);
    }
  }
  return result;
}

module.exports = {
  getPassTypes,
  savePassType,
};
