const sqlconnector = require("../db/SqlConnector");
const club_id = process.env.CLUB_ID;
const RESTError = require("../utils/RESTError");

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
            club_id = ?`;

  const guest_pass_types_res = await sqlconnector.withConnection(
    async (connection) => {
      return sqlconnector.runExecute(connection, guest_pass_types_q, [club_id]);
    }
  );

  if (
    !Array.isArray(guest_pass_types_res) ||
    guest_pass_types_res.length < 1
  ) {
    throw new RESTError(400, "Failed loading guest pass types");
  }

  return guest_pass_types_res.map((pass_type) => {
    return {
      id: pass_type.id,
      label: pass_type.label,
      valid: pass_type.valid_days,
      limit: pass_type.season_limit,
      cost: pass_type.cost,
    };
  });
};

module.exports = {
  getPassTypes,
};
