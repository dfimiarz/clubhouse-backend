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
                dur_min: Number(row.dur_min),
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
            UNIX_TIMESTAMP(gp.created) DIV 1 as created_utc,
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
                    created_utc: Number(row.created_utc),
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






/**
 * Rebooking prompt funnel, one row per day in the range.
 *
 * Counts events rather than bookings: `offered` is the number of dialogs shown,
 * so it is the correct denominator for the accept rate. Days with no activity
 * are filled with zeroes so the series is continuous for charting.
 *
 * `booked` counts bookings that followed an accepted suggestion, split into
 * those that kept the suggested time and those the user edited first. An
 * acceptance with no booking at all was abandoned — derive that across the
 * whole range rather than per day, since a flow can cross midnight.
 *
 * `fast_rebooked` counts Booking Details Fast rebook completions. It is not
 * part of the form-prompt funnel and does not affect `accept_rate`.
 *
 * @param {String} name Processor name
 * @param {String} from Date in ISO format, club local
 * @param {String} to Date in ISO format, club local
 * @returns {Array<Object>} date, offered, accepted, declined, booked, booked_kept, booked_changed, accept_rate, fast_rebooked
 */
const rebookingProcessor = async function (name, from, to) {

    // app_event.created is UTC (the pool runs timezone "Z"), while from/to are
    // club-local dates, so days are bucketed in the club's zone the same way
    // the guest pass report converts its timestamps.
    const rebooking_q =
        `SELECT
            DATE_FORMAT(CONVERT_TZ(e.created, 'UTC', c.time_zone), GET_FORMAT(DATE, 'ISO')) AS date,
            SUM(e.name = 'rebooking_offered') AS offered,
            SUM(e.name = 'rebooking_accepted') AS accepted,
            SUM(e.name = 'rebooking_declined') AS declined,
            SUM(e.name = 'rebooking_booked') AS booked,
            SUM(e.name = 'rebooking_booked' AND e.props->'$.kept_offer' = TRUE) AS booked_kept,
            SUM(e.name = 'fast_rebook_completed') AS fast_rebooked
        FROM
            app_event e
                JOIN
            club c ON c.id = e.club
        WHERE
            e.club = ?
            AND e.name IN ('rebooking_offered', 'rebooking_accepted', 'rebooking_declined', 'rebooking_booked', 'fast_rebook_completed')
            AND DATE(CONVERT_TZ(e.created, 'UTC', c.time_zone)) BETWEEN ? AND ?
        GROUP BY date
        ORDER BY date`;

    try {
        const result = await sqlconnector.withConnection(async (connection) => {
            return sqlconnector.runExecute(connection, rebooking_q, [CLUB_ID, from, to]);
        });

        if (!Array.isArray(result)) {
            throw new Error("Unable to retrieve report data");
        }

        const resultMap = getDateMap(from, to, { offered: 0, accepted: 0, declined: 0, booked: 0, booked_kept: 0, fast_rebooked: 0 });

        result.forEach(row => {
            resultMap.set(row.date, {
                offered: Number(row.offered),
                accepted: Number(row.accepted),
                declined: Number(row.declined),
                booked: Number(row.booked),
                booked_kept: Number(row.booked_kept),
                fast_rebooked: Number(row.fast_rebooked),
            });
        });

        return Array.from(resultMap, ([date, value]) => ({
            date: date,
            offered: value.offered,
            accepted: value.accepted,
            declined: value.declined,
            booked: value.booked,
            booked_kept: value.booked_kept,
            // Accepted the suggestion, then edited the start time before booking.
            booked_changed: value.booked - value.booked_kept,
            // Booking Details shortcut — not part of the form-prompt funnel.
            fast_rebooked: value.fast_rebooked,
            // Null rather than 0 on a day with no offers: nothing was asked, so
            // there is no rate to report and a chart should show a gap.
            accept_rate: value.offered === 0 ? null : Math.round((value.accepted / value.offered) * 100) / 100
        }));

    } catch (err) {
        log(appLogLevels.ERROR, `Error generating report '${name}': ${err.message}`);
        throw new RESTError(500, "Request failed");
    }

}

/**
 * Rebooking prompt outcomes per player, busiest first.
 *
 * The players an event involved live in its props as a JSON array, so they are
 * expanded with JSON_TABLE before joining to person. There is no foreign key,
 * which is deliberate: events outlive the people in them. The join therefore
 * drops ids for deleted members, and these rows can sum to less than the daily
 * totals from the 'rebooking' report.
 *
 * @param {String} name Processor name
 * @param {String} from Date in ISO format, club local
 * @param {String} to Date in ISO format, club local
 * @returns {Array<Object>} person, player, offers, accepts, declines, accept_rate
 */
const rebookingPlayersProcessor = async function (name, from, to) {

    const players_q =
        `SELECT
            p.id AS person,
            CONCAT(p.firstname, ' ', p.lastname) AS player,
            SUM(e.name = 'rebooking_offered') AS offers,
            SUM(e.name = 'rebooking_accepted') AS accepts,
            SUM(e.name = 'rebooking_declined') AS declines
        FROM
            app_event e
                JOIN
            club c ON c.id = e.club
                JOIN
            JSON_TABLE(e.props, '$.person_ids[*]' COLUMNS (person_id INT PATH '$')) jt ON TRUE
                JOIN
            person p ON p.id = jt.person_id AND p.club = e.club
        WHERE
            e.club = ?
            AND e.name IN ('rebooking_offered', 'rebooking_accepted', 'rebooking_declined')
            AND DATE(CONVERT_TZ(e.created, 'UTC', c.time_zone)) BETWEEN ? AND ?
        GROUP BY p.id
        ORDER BY offers DESC, player`;

    try {
        const result = await sqlconnector.withConnection(async (connection) => {
            return sqlconnector.runExecute(connection, players_q, [CLUB_ID, from, to]);
        });

        if (!Array.isArray(result)) {
            throw new Error("Unable to retrieve report data");
        }

        return result.map(row => {
            const offers = Number(row.offers);

            return {
                person: row.person,
                player: row.player,
                offers: offers,
                accepts: Number(row.accepts),
                declines: Number(row.declines),
                accept_rate: offers === 0 ? null : Math.round((Number(row.accepts) / offers) * 100) / 100
            };
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
    rebookingProcessor,
    rebookingPlayersProcessor,

}