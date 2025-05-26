const sqlconnector = require("../db/SqlConnector");
const RESTError = require("./../utils/RESTError");
const { storeJSON, getJSON } = require("./../db/RedisConnector");
const { log, appLogLevels } = require("./../utils/logger/logger");
const e = require("express");

const CLUB_ID = process.env.CLUB_ID;
const USE_REDIS = process.env.USE_REDIS === "true";

/**
 * Retrieves club information for a given club_id
 */
async function getClubInfo() {
  const redisKey = `club_info_${CLUB_ID}`;

  if (USE_REDIS) {
    //Check if club info is in redis
    const clubInfo = await getJSON(redisKey);

    if (clubInfo) {
      return clubInfo;
    }
  }

  //Get club info from database

  const club_query = `SELECT 
                            id,
                            name,
                            time_zone,
                            guest_reg_limit,
                            default_cal_start,
                            default_cal_end,
                            time_to_sec(default_cal_start) DIV 60 as default_cal_start_min,
                            time_to_sec(default_cal_end) DIV 60 as default_cal_end_min
                        FROM 
                            club
                        WHERE id = ?`;

  const settings_query = `SELECT
    s.id,
    s.key,
    COALESCE(cs.value, s.default_val) AS value,
    s.description,
    s.value_type
    FROM
        settings s
    LEFT JOIN
        club_settings cs ON s.id = cs.setting_id AND cs.club_id = ?
    ORDER BY s.key`;

  //Get images used by by the club
  const image_query = `SELECT
                            name,
                            src
                        FROM
                            images
                        WHERE
                            club = ?`;

  const connection = await sqlconnector.getConnection();

  try {
    const club_results = await sqlconnector.runQuery(connection, club_query, [
      CLUB_ID,
    ]);

    if (!Array.isArray(club_results) && club_results.length != 1) {
      throw new Error("Unable to load club data");
    }

    const club = club_results[0];

    const result = {
      id: club["id"],
      name: club["name"],
      time_zone: club["time_zone"],
      guest_req_limit: club["guest_req_limit"],
      default_cal_start: club["default_cal_start"],
      default_cal_start_min: club["default_cal_start_min"],
      default_cal_end: club["default_cal_end"],
      default_cal_end_min: club["default_cal_end_min"],
    };

    const settings_results = await sqlconnector.runQuery(
      connection,
      settings_query,
      [CLUB_ID]
    );

    if (Array.isArray(settings_results) && settings_results.length > 0) {
      result.settings = settings_results.reduce((acc, setting) => {
        if (setting["key"]) {
          //If settings.value_type is 'bool', convert to boolean, otherwise keep as string
          if (setting["value_type"] === "bool") {
            acc[setting["key"]] = setting["value"] === "true";
          } else {
            acc[setting["key"]] = setting["value"];
          }
        }
        return acc;
      }, {});
    } else {
      result.settings = {};
    }

    const images_results = await sqlconnector.runQuery(
      connection,
      image_query,
      [CLUB_ID]
    );

    if (Array.isArray(images_results) && images_results.length > 0) {
      result.images = images_results.map((image) => {
        return {
          name: image["name"],
          src: image["src"],
        };
      });
    } else {
      result.images = [];
    }

    if (USE_REDIS) {
      //Store club info in redis
      await storeJSON(redisKey, result);
    }

    return result;
  } catch (error) {
    log(appLogLevels.ERROR, `Error getting club info: ${error.message}`);
    throw new RESTError(500, "Failed loading club info");
  } finally {
    connection.release();
  }
}

module.exports = {
  getClubInfo,
};
