const dayjs = require('dayjs');
const sqlconnector = require('../db/SqlConnector');
const { log, appLogLevels } = require('./../utils/logger/logger');
const RESTError = require('./../utils/RESTError');

const CLUB_ID = process.env.CLUB_ID;

/**
 *  @param {String} name Report name
 *  @param {String} from Start date in ISO format
 *  @param {String} to End date in ISO format
 *  @returns {Array<Object>}   Array of objects with the following properties:
 * - {String} date Date in ISO format
 * - {Number} time_played Total time played in minutes
 * - {Number} player_count Number of players
 *  
 */
const playerStatsProcessor = async (name, from, to) => {

    const time_played_q =
        `select 
        DATE_FORMAT(a.date,GET_FORMAT(DATE,'ISO')) as date,
        sum(round((time_to_sec(a.end)-time_to_sec(a.start))/60,2)) as time_played,
        count(distinct(p.person)) as player_count
    from 
        participant p
        join person pr on pr.id = p.person 
        join activity a on p.activity = a.id 
        join activity_type at on at.id = a.type 
        join activity_group ag on ag.id = at.group
    where 
        ag.id = 1 and 
        active = 1
        and a.date between ? and ?
        and pr.club = ?
    group by a.date`;

    try {
        const result = await sqlconnector.withConnection(async (connection) => {
            return sqlconnector.runExecute(connection, time_played_q, [from, to, CLUB_ID]);
        });

        if (!Array.isArray(result)) {
            throw new Error("Unable to retrieve report data");
        }

        // Get dates between from and to in a map
        const resultMap = getDateMap(from, to, {time_played: 0, player_count: 0});

        // For each row in the result, update the corresponding entry in resultMap with the time played and player count from the row.
        result.forEach(row => {
            resultMap.set(row.date, { time_played: row.time_played, player_count: row.player_count });
        });

        // Convert the resultMap to an array of objects, each with properties 'date', 'time_played', and 'player_count'.
        return Array.from(resultMap, ([date, value]) => ({ date: date, time_played: value.time_played, player_count: value.player_count }));

    } catch (err) {
        log(appLogLevels.ERROR, `Error generating report '${name}': ${err.message}`);
        throw new RESTError(500, "Request failed");
    }

}

/**
 * 
 * @param {string} startDate ISO8601 date string
 * @param {string} endDate ISO8601 date string
 * @param {Number} initialValue Initial value for the map
 * @returns {Map} A map of ordered dates between startDate and endDate with the following properties:
 *  - {string} date Date in ISO8601 format
 *  - {Number} initialValue Initial value for the map
 */
function getDateMap(startDate, endDate, initialValue = 0) {
    const dates = new Map();

    //loop through dates betwen startDate and endDate
    var theDate = dayjs(startDate).valueOf();
    const finalDate = dayjs(endDate).valueOf();

    while (theDate <= finalDate) {
        //add date to map
        dates.set(dayjs(theDate).format('YYYY-MM-DD'), initialValue);
        //add 1 day
        theDate = dayjs(theDate).add(1, 'day').valueOf();
    }

    return dates;
}

const memberActivitiesProcessor = async function (name, from, to) {
    const activities_q =
        `SELECT
        p.id AS participant_id,
        a.id AS activity_id,
        c.name AS court,
        DATE_FORMAT(a.date, GET_FORMAT(DATE, 'ISO')) AS date,
        a.start,
        a.end,
        ROUND((TIME_TO_SEC(end) - TIME_TO_SEC(start)) / 60,
                2) AS dur_min,
        CONCAT(pr.firstname, ' ', pr.lastname) AS player,
        pt.desc AS player_type,
        role.lbl AS member_role
    FROM
        activity a
            JOIN
        participant p ON p.activity = a.id
            JOIN
        person pr ON pr.id = p.person
            JOIN
        participant_type pt ON pt.id = p.type
            JOIN
        court c ON c.id = a.court
            JOIN
        activity_type at ON at.id = a.type
            JOIN
        activity_group ag ON ag.id = at.group
            JOIN
        membership m on pr.id = m.person_id
            JOIN
        role on m.role = role.id
    WHERE
        a.active = 1
        AND ag.id = 1
        AND a.date BETWEEN ? AND ?
        AND pr.club = ?
        AND m.valid_from <= a.date AND m.valid_until > a.date
    ORDER BY date , start`;

    try {
        const result = await sqlconnector.withConnection(async (connection) => {
            return sqlconnector.runExecute(connection, activities_q, [from, to, CLUB_ID]);
        });

        if (!Array.isArray(result)) {
            throw new Error("Unable to retrieve report data");
        }

        return result.map(row => {
            return {
                participant_id: row.participant_id,
                activity_id: row.activity_id,
                court: row.court,
                date: row.date,
                start: row.start,
                end: row.end,
                dur_min: row.dur_min,
                player: row.player,
                player_type: row.player_type,
                member_role: row.member_role,
            }
        });

    } catch (err) {
        log(appLogLevels.ERROR, `Error generating report '${name}': ${err.message}`)
        throw new RESTError(500, "Request failed");
    }

}

/**
 * 
 * @param {String} name Processor name
 * @param {String} from Date in ISO format
 * @param {String} to Date in ISO format
 * @returns 
 */
const guestPassesProcessor = async function (name, from, to) {

    //Add begining and end of day to from and to
    const from_dt = dayjs(from).startOf('day').format('YYYY-MM-DDTHH:mm:ss');
    const to_dt = dayjs(to).endOf('day').format('YYYY-MM-DDTHH:mm:ss');

    const passes_q =
        `SELECT 
            gp.id,
            UNIX_TIMESTAMP(gp.created) as created_utc,
            DATE_FORMAT(CONVERT_TZ(gp.created,'UTC',c.time_zone),'%m/%d/%y %h:%i %p') as created,
            DATE_FORMAT(valid_from, '%m/%d/%y %h:%i %p') as valid_from,
            DATE_FORMAT(valid_to, '%m/%d/%y %h:%i %p') as valid_to,
            concat(host.firstname," ",host.lastname) as host,
            concat(guest.firstname," ",guest.lastname) as guest,
            gp.type as pass_type_id,
            guest_pass_type.label as pass_type_label
        FROM guest_pass gp
        JOIN person as guest on gp.guest_id = guest.id
        JOIN person as host on gp.member_id = host.id
        JOIN guest_pass_type on gp.type = guest_pass_type.id
        JOIN club c on host.club = c.id
        WHERE 
            valid_from < ? AND valid_to > ?
            AND valid = 1
            AND host.club = ? 
        ORDER BY gp.created DESC`;

        try {
            const result = await sqlconnector.withConnection(async (connection) => {
                return sqlconnector.runExecute(connection, passes_q, [to_dt, from_dt, CLUB_ID]);
            });
    
            if (!Array.isArray(result)) {
                throw new Error("Unable to retrieve report data");
            }
    
            return result.map(row => {
                return {
                    pass_id: row.id,
                    created: row.created,
                    created_utc: row.created_utc,
                    valid_from: row.valid_from,
                    valid_to: row.valid_to,
                    host: row.host,
                    guest: row.guest,
                    pass_type_id: row.pass_type_id,
                    pass_type_label: row.pass_type_label
                }
            });
    
        } catch (err) {
            log(appLogLevels.ERROR, `Error generating report '${name}': ${err.message}`);
            throw new RESTError(500, "Request failed");
        }
}





module.exports = {
    playerStatsProcessor,
    memberActivitiesProcessor,
    guestPassesProcessor,

}