const sqlconnector = require("../db/SqlConnector");
const club_id = process.env.CLUB_ID;
const RESTError = require("../utils/RESTError");
const {
  loadClubPassTypeSettings,
  rulesForPassType,
  passTypeRules,
} = require("./settings");
const { passTypeSchema } = require("./validation");
const redisconnector = require("../db/RedisConnector");
const { log, appLogLevels } = require("../utils/logger/logger");

/**
 * @typedef {import("./types").PassType} PassType;
 */

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

    return guest_pass_types_res.map((pass_type) => {
      return {
        id: pass_type.id,
        label: pass_type.label,
        valid: pass_type.valid_days,
        limit: pass_type.season_limit,
        cost: pass_type.cost,
        ...rulesForPassType(settingsByType, pass_type.id),
      };
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

    if (data.settings.play_after === null) {
      await sqlconnector.runExecute(connection,
        "DELETE FROM guest_pass_type_setting WHERE pass_type = ? AND setting_key = ?",
        [id, "play_after"]);
    } else {
      await sqlconnector.runExecute(connection,
        `INSERT INTO guest_pass_type_setting (pass_type, setting_key, setting_value)
         VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
        [id, "play_after", data.settings.play_after]);
    }
    return { id, ...data, ...passTypeRules(data.settings) };
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
