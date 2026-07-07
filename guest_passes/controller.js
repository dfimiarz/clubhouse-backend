const sqlconnector = require("../db/SqlConnector");
const redisconnector = require("../db/RedisConnector");
const { log, appLogLevels } = require("../utils/logger/logger");
const club_id = process.env.CLUB_ID;
//const SQLErrorFactory = require("./../utils/SqlErrorFactory");
const RESTError = require("../utils/RESTError");

const CONSTANTS = require("./../utils/dbconstants");

const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");

dayjs.extend(utc);
dayjs.extend(timezone);

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
  (\`id\`,
  \`created\`,
  \`updated\`,
  \`guest_id\`,
  \`member_id\`,
  \`valid\`,
  \`type\`,
  \`valid_from\`,
  \`valid_to\`) 
  VALUES 
  (null, default, default,?,?,default,?,?,?)`;

  const club_info_q = `
    select 
      c.id,
      c.name,
      c.time_zone,
      cs.id as season_id,
      cs.name as season_name,
      cs.start as season_start,
      cs.end as season_end 
    from club c join club_seasons cs on cs.club = c.id 
    WHERE
      c.id = ?
      AND DATE(convert_tz(NOW(),@@GLOBAL.time_zone,c.time_zone)) >= cs.start 
      AND DATE(convert_tz(NOW(),@@GLOBAL.time_zone,c.time_zone)) < cs.end
    FOR SHARE`;

  const role_check_q = `SELECT mv.role_type_id,guest_host 
                        FROM membership_view mv 
                        JOIN club c ON c.id = mv.club
                        WHERE mv.id = ? AND club = ? 
                        AND DATE(convert_tz(NOW(),@@GLOBAL.time_zone,c.time_zone)) >= mv.valid_from 
                        AND DATE(convert_tz(NOW(),@@GLOBAL.time_zone,c.time_zone)) < mv.valid_until FOR SHARE`;

  const guest_pass_typq_q = `SELECT label, valid_days, season_limit FROM guest_pass_type WHERE id = ? and club_id  = ? FOR SHARE`;

  const connection = await sqlconnector.getConnection();

  try {
    await sqlconnector.runQuery(connection, "START TRANSACTION", []);

    try {
      const club_info_res = await sqlconnector.runQuery(
        connection,
        club_info_q,
        club_id
      );

      if (!(Array.isArray(club_info_res) && club_info_res.length === 1)) {
        throw new RESTError(400, "Incorrect club data");
      }

      //Get club id and season info
      // Season start is inclusive
      const season_start = club_info_res[0].season_start;
      // Season end is exclusive
      const season_end = club_info_res[0].season_end;
      const time_zone = club_info_res[0].time_zone;

      const host_data_res = await sqlconnector.runQuery(
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

      const guest_data_res = await sqlconnector.runQuery(
        connection,
        role_check_q,
        [passinfo.guest, club_id]
      );

      if (!(Array.isArray(guest_data_res) && guest_data_res.length === 1)) {
        throw new RESTError(400, "Guest not found");
      }

      //Check if person designated as guest is actually a guest
      const guest_role_type = guest_data_res[0].role_type_id;

      if (guest_role_type !== CONSTANTS.ROLE_TYPES.GUEST_TYPE) {
        throw new RESTError(400, "Invalid guest");
      }

      const pass_type_res = await sqlconnector.runQuery(
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

      //console.log(passes);

      //Find if there is an active pass already for the guest
      const active_pass = passes.find((pass) => pass.active === 1);

      //If there is an active pass, return pass info
      if (active_pass) {
        await sqlconnector.runQuery(connection, "COMMIT", []);

        return {
          id: active_pass.id,
          label: active_pass.label,
          type: active_pass.type,
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

      if (valid_days < 1) {
        throw new RESTError(400, "Invalid pass configuration");
      }

      //Pass is valid from beinging of the day
      const valid_from = dayjs().tz(time_zone).startOf("day");

      //Throw error if valid_from is before season start
      if (valid_from.isBefore(season_start)) {
        throw new RESTError(400, "Pass is not available");
      }

      //Pass is valid to valid_from + valid_days - 1
      let valid_to = valid_from.add(valid_days - 1, "day").endOf("day");

      //Format both dates to YYYY-MM-DD HH:mm:ss
      const v_f_formatted = valid_from.format("YYYY-MM-DD HH:mm:ss");

      // Check if valid_to is after season end and format accordingly. 
      // Season end is exclusive so we need to subtract 1 second from the season end date
      const v_t_formatted = valid_to.isAfter(season_end)
        ? dayjs(season_end).tz(time_zone).subtract(1, 'second').format("YYYY-MM-DD HH:mm:ss")
        : valid_to.format("YYYY-MM-DD HH:mm:ss");

      const guest_pass_res = await sqlconnector.runQuery(
        connection,
        insert_guest_pass_q,
        [
          passinfo.guest,
          passinfo.host,
          passinfo.pass_type,
          v_f_formatted,
          v_t_formatted,
        ]
      );

      await sqlconnector.runQuery(connection, "COMMIT", []);

      //Invalidate the active-persons cache so the new pass is reflected immediately.
      //Best effort: the cache TTL bounds staleness if the delete fails.
      try {
        await redisconnector.deleteKey(`active_persons_${club_id}`);
      } catch (error) {
        log(appLogLevels.WARNING, `Error invalidating active persons cache: ${error}`);
      }

      return {
        id: guest_pass_res.insertId,
        label: pass_type_label,
        type: passinfo.pass_type,
      };
    } catch (err) {
      console.log(err);
      await sqlconnector.runQuery(connection, "ROLLBACK", []);
      throw err instanceof RESTError
        ? err
        : new RESTError(500, "Unable to activate", err);
    }
  } finally {
    connection.release();
  }
};

/**
 *
 * @param {import("mysql").PoolConnection} connection MySQL connection
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
    IF(convert_tz(NOW(),@@GLOBAL.time_zone,c.time_zone) BETWEEN gp.valid_from and gp.valid_to,1,0) as active
  FROM clubhouse.guest_pass gp
	  join guest_pass_type gpt on gpt.id = gp.type
    join club c on gpt.club_id = c.id
  WHERE c.id = ? and guest_id = ? and valid_from < ? and valid_to > ? and valid = 1
  FOR SHARE`;

  const guest_passes_res = await sqlconnector.runQuery(
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
