const sqlconnector = require("../db/SqlConnector");
const redisconnector = require("../db/RedisConnector");
const { log, appLogLevels } = require("../utils/logger/logger");
const club_id = process.env.CLUB_ID;
//const SQLErrorFactory = require("./../utils/SqlErrorFactory");
const RESTError = require("../utils/RESTError");
const {
  loadSettingsForPassType,
  passTypeRules,
} = require("../guest-pass-types/settings");
const {
  NO_SEASON_REASON,
  loadSaleContext,
  evaluateSale,
} = require("../guest-pass-types/sale");

/**
 * @typedef {import("./types").PassInfo} PassInfo;
 */

/**
 *
 * @param {PassInfo} passinfo
 * @returns
 */
const addGuestPass = async (passinfo) => {
  const insert_guest_pass_q = `INSERT INTO \`guest_pass\`
  (\`guest_id\`, \`member_id\`, \`type\`, \`valid_from\`, \`valid_to\`)
  VALUES (?, ?, ?, ?, ?)`;

  const role_check_q = `SELECT mv.role_type_id,guest_host,requires_pass
                        FROM membership_view mv 
                        JOIN club c ON c.id = mv.club
                        WHERE mv.id = ? AND club = ? 
                        AND DATE(convert_tz(NOW(),@@session.time_zone,c.time_zone)) >= mv.valid_from
                        AND DATE(convert_tz(NOW(),@@session.time_zone,c.time_zone)) < mv.valid_until FOR SHARE`;

  const guest_pass_typq_q = `SELECT label, valid_days, season_limit FROM guest_pass_type WHERE id = ? and club_id  = ? FOR SHARE`;

  try {
    const result = await sqlconnector.withTransaction(async (connection) => {
      const sale = await loadSaleContext(connection, club_id, { lock: true });

      if (!sale) {
        throw new RESTError(400, NO_SEASON_REASON);
      }

      // Season start is inclusive
      const season_start = sale.season.season_start;
      // Season end is exclusive
      const season_end = sale.season.season_end;

      const host_data_res = await sqlconnector.runExecute(
        connection,
        role_check_q,
        [passinfo.host, club_id]
      );

      if (!(Array.isArray(host_data_res) && host_data_res.length === 1)) {
        throw new RESTError(400, "Invalid host");
      }

      //Check if host is allowed to host guests
      const guest_host = host_data_res[0].guest_host;

      if (guest_host !== 1) {
        throw new RESTError(400, "Invalid guest host");
      }

      const guest_data_res = await sqlconnector.runExecute(
        connection,
        role_check_q,
        [passinfo.guest, club_id]
      );

      if (!(Array.isArray(guest_data_res) && guest_data_res.length === 1)) {
        throw new RESTError(400, "Guest not found");
      }

      //Check if person designated as guest actually plays on passes
      if (guest_data_res[0].requires_pass !== 1) {
        throw new RESTError(400, "Invalid guest");
      }

      const pass_type_res = await sqlconnector.runExecute(
        connection,
        guest_pass_typq_q,
        [passinfo.pass_type, club_id]
      );

      if (!(Array.isArray(pass_type_res) && pass_type_res.length === 1)) {
        throw new RESTError(400, "Invalid pass type");
      }

      //Get valid_days, season_limit, and label from pass type
      const valid_days = pass_type_res[0].valid_days;
      const season_limit = pass_type_res[0].season_limit;
      /** @type {string} */
      const pass_type_label = pass_type_res[0].label;

      //Get passes for a given time frame
      const passes = await _getGuestPasses(
        connection,
        passinfo.guest,
        season_start,
        season_end
      );

      //Find if there is an active pass already for the guest
      const active_pass = passes.find((pass) => pass.active === 1);

      //If there is an active pass, return pass info (no cache invalidation)
      if (active_pass) {
        const rules = passTypeRules(
          await loadSettingsForPassType(connection, active_pass.type, {
            lock: true,
          })
        );
        return {
          id: active_pass.id,
          label: active_pass.label,
          type: active_pass.type,
          created: false,
          ...rules,
        };
      }

      //Check if guest has reached the season limit
      if (season_limit > 0) {
        const passCountForGuest = passes.filter(
          (pass) => pass.type === passinfo.pass_type
        ).length;

        if (passCountForGuest >= season_limit) {
          throw new RESTError(400, "Guest has reached the season limit");
        }
      }

      const type_settings = await loadSettingsForPassType(
        connection,
        passinfo.pass_type,
        { lock: true }
      );

      //Refuse a pass that is misconfigured or leaves no playable time before it expires
      const { window, reason } = evaluateSale(
        sale,
        { label: pass_type_label, valid_days },
        type_settings
      );
      if (reason) {
        throw new RESTError(400, reason);
      }

      const guest_pass_res = await sqlconnector.runExecute(
        connection,
        insert_guest_pass_q,
        [
          passinfo.guest,
          passinfo.host,
          passinfo.pass_type,
          window.from,
          window.to,
        ]
      );

      const rules = passTypeRules(type_settings);

      return {
        id: guest_pass_res.insertId,
        label: pass_type_label,
        type: passinfo.pass_type,
        created: true,
        ...rules,
      };
    });

    //Invalidate the active-persons cache only when a new pass was created.
    //Best effort: the cache TTL bounds staleness if the delete fails.
    if (result.created) {
      try {
        await redisconnector.deleteKey(`active_persons_${club_id}`);
      } catch (error) {
        log(appLogLevels.WARNING, `Error invalidating active persons cache: ${error}`);
      }
    }

    return {
      id: result.id,
      label: result.label,
      type: result.type,
      settings: result.settings,
      constraints: result.constraints,
    };
  } catch (err) {
    log(appLogLevels.ERROR, `Error activating guest pass: ${err.message}`);
    throw err instanceof RESTError
      ? err
      : new RESTError(500, "Unable to activate");
  }
};

/**
 *
 * @param {import("mysql2").PoolConnection} connection MySQL connection
 * @param {Number} guest_id Guest ID
 * @param {String} season_start Season start date
 * @param {String} season_end Season end date
 * @returns {Promise<Array.<import("./types").GuestPass>>} Guest passes for a guest within a given time frame
 */
async function _getGuestPasses(connection, guest_id, season_start, season_end) {
  //TODO: Use the correct query
  const guest_passes_q = `
  SELECT 
	  gp.id,
    gp.created as created_utc,
    gp.updated as updated_utc,
	  gp.guest_id,
    gp.member_id,
    gp.valid,
    gp.type,
    gp.valid_from,
    gp.valid_to,
    gpt.label,
    IF(convert_tz(NOW(),@@session.time_zone,c.time_zone) BETWEEN gp.valid_from and gp.valid_to,1,0) as active
  FROM clubhouse.guest_pass gp
	  join guest_pass_type gpt on gpt.id = gp.type
    join club c on gpt.club_id = c.id
  WHERE c.id = ? and guest_id = ? and valid_from < ? and valid_to > ? and valid = 1
  FOR SHARE`;

  const guest_passes_res = await sqlconnector.runExecute(
    connection,
    guest_passes_q,
    [club_id, guest_id, season_end, season_start]
  );

  if (!Array.isArray(guest_passes_res)) {
    throw new RESTError(400, "Unable to read pass data");
  }

  return guest_passes_res.map((pass) => {
    return {
      id: pass.id,
      created_utc: pass.created_utc,
      updated_utc: pass.updated_utc,
      guest: pass.guest_id,
      host: pass.member_id,
      valid: pass.valid,
      type: pass.type,
      valid_from: pass.valid_from,
      valid_to: pass.valid_to,
      label: pass.label,
      active: pass.active,
    };
  });
}

module.exports = {
  addGuestPass,
};
