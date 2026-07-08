const sqlconnector = require('../db/SqlConnector');
const RESTError = require('./../utils/RESTError');
const { storeJSON, getJSON } = require('./../db/RedisConnector');
const { log, appLogLevels } = require('./../utils/logger/logger');
const e = require('express');

const CLUB_ID = process.env.CLUB_ID;

/**
 * Retrieves club information for a given club_id
 */
async function getClubInfo() {

    const redisKey = `club_info_${CLUB_ID}`;

    //Check if club info is in redis; on Redis errors fall back to the database
    let clubInfo = null;
    try {
        clubInfo = await getJSON(redisKey);
    } catch (error) {
        log(appLogLevels.ERROR, `Error retrieving club info from cache: ${error}`);
    }

    if (clubInfo) {
        return clubInfo;
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

    //Get images used by by the club
    const image_query = `SELECT
                            name,
                            src
                        FROM
                            images
                        WHERE
                            club = ?`;

    //Get about sections for the club
    const about_query = `SELECT
                            title,
                            image_url,
                            text_content
                        FROM
                            about_section
                        WHERE
                            club = ?
                        ORDER BY sort_order`;

    //Get roles with their role type info (global reference tables, not club-specific)
    const roles_query = `SELECT
                            role.id as id,
                            role.lbl as label,
                            role_type.id as type_id,
                            role_type.label as type_label,
                            role_type.event_host as event_host,
                            role_type.guest_host as guest_host,
                            role_type.requires_pass as requires_pass,
                            role_type.public_label as public_label
                        FROM
                            role
                        JOIN role_type ON role.type = role_type.id
                        ORDER BY role.id`;

    const connection = await sqlconnector.getConnection();

    try {

        const club_results = await sqlconnector.runQuery(connection, club_query, [CLUB_ID]);

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
        }

        const images_results = await sqlconnector.runQuery(connection, image_query, [CLUB_ID]);

        if( Array.isArray(images_results) && images_results.length > 0) {

            result.images = images_results.map((image) => {
                return {
                    name: image["name"],
                    src: image["src"]
                }
            }
            );
        }
        else {
            result.images = [];
        }

        const about_results = await sqlconnector.runQuery(connection, about_query, [CLUB_ID]);

        if (Array.isArray(about_results) && about_results.length > 0) {
            result.about_sections = about_results.map((section) => {
                return {
                    title: section["title"],
                    image_url: section["image_url"],
                    text: section["text_content"]
                }
            });
        }
        else {
            result.about_sections = [];
        }

        const roles_results = await sqlconnector.runQuery(connection, roles_query, []);

        if (!Array.isArray(roles_results) || roles_results.length === 0) {
            throw new Error("Unable to load roles");
        }

        result.roles = roles_results.map((role) => {
            return {
                id: role["id"],
                label: role["label"],
                type_id: role["type_id"],
                type_label: role["type_label"],
                event_host: role["event_host"],
                guest_host: role["guest_host"],
                requires_pass: role["requires_pass"],
                public_label: role["public_label"]
            }
        });

        //Store club info in redis; a cache failure should not fail the request
        try {
            await storeJSON(redisKey, result);
        } catch (error) {
            log(appLogLevels.ERROR, `Error storing club info to cache: ${error}`);
        }

        return result;

    }
    catch (error) {
        log(appLogLevels.ERROR, `Error getting club info: ${error.message}`);
        throw new RESTError(500, "Failed loading club info");
    }
    finally {
        connection.release()
    }
}

module.exports = {
    getClubInfo
}
