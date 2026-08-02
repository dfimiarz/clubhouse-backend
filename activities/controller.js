const { log, appLogLevels } = require('./../utils/logger/logger');
const RESTError = require('./../utils/RESTError');

const sqlconnector = require('../db/SqlConnector');

const CLUB_ID = process.env.CLUB_ID;


async function getActivitiesForDates(from, to) {


    const activities_q =
        `SELECT 
            a.id,
            a.created,
            a.updated,
            c.id as court_id,
            c.name as court_name,
            a.start,
            a.end,
            time_to_sec(a.start) DIV 60 as start_min,
            time_to_sec(a.end) DIV 60 as end_min,
            DATE_FORMAT(a.date, GET_FORMAT(DATE, 'ISO')) AS date,
            dayofweek(a.date) as day_of_week,
            at.id as type_id,
            at.lbl as type_lbl,
            ag.id as group_type_id,
            ag.label as group_type_lbl,
            ag.utility_factor as group_utility,
            c.club as club_id
        FROM
            activity a
                JOIN
            court c ON c.id = a.court
                JOIN
            activity_type at ON at.id = a.type
                JOIN
            activity_group ag ON ag.id = at.group
        WHERE
            a.active = 1
                AND a.date BETWEEN ? AND ? 
                AND c.club = ?
        ORDER BY date , start`;

    try {
        const result = await sqlconnector.withConnection(async (connection) => {
            return sqlconnector.runExecute(connection, activities_q, [from, to, CLUB_ID]);
        });

        if (!Array.isArray(result)) {
            throw new Error("Unable to retrieve activity data");
        }

        return result.map(row => {
            return {
                id: row.id,
                created: row.created,
                updated: row.updated,
                court_id: row.court_id,
                court_name: row.court_name,
                start: row.start,
                end: row.end,
                start_min: row.start_min,
                end_min: row.end_min,
                date: row.date,
                day_of_week: row.day_of_week,
                type_id: row.type_id,
                type_lbl: row.type_lbl,
                group_type_id: row.group_type_id,
                group_type_lbl: row.group_type_lbl,
                group_utility: row.group_utility,
                club_id: row.club_id
            }
        });

    } catch (err) {
        log(appLogLevels.ERROR, `Error getting activities: ${err.message}`);
        throw new RESTError(500, "Request failed");
    }

}


module.exports = {
    getActivitiesForDates
}