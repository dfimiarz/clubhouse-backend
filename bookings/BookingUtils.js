const sqlconnector = require('../db/SqlConnector');
const { formatQuery, transactionType } = require('../utils/dbutils');

const CLUB_ID = process.env.CLUB_ID;

const booking_q = `SELECT c.id AS court_id,
                        UNIX_TIMESTAMP(CONVERT_TZ(CONCAT(a.date, ' ', a.start),cl.time_zone,@@GLOBAL.time_zone)) AS utc_start,
                        UNIX_TIMESTAMP(CONVERT_TZ(CONCAT(a.date, ' ', a.end),cl.time_zone,@@GLOBAL.time_zone)) AS utc_end,
                        UNIX_TIMESTAMP(a.created) AS utc_created,
                        UNIX_TIMESTAMP(a.updated) AS utc_updated,
                        UNIX_TIMESTAMP(CONVERT_TZ(a.date,cl.time_zone,@@GLOBAL.time_zone)) AS utc_day_start,
                        UNIX_TIMESTAMP(NOW()) AS utc_req_time,
                        CAST(CONVERT_TZ(NOW(), @@GLOBAL.time_zone, cl.time_zone) AS DATE) + 0 AS loc_req_date,
                        CAST(CONVERT_TZ(NOW(), @@GLOBAL.time_zone, cl.time_zone) AS TIME) AS loc_req_time,
                        DATE_FORMAT(a.date,"%Y-%m-%d" ) as date,
                        a.date + 0 as numeric_date,
                        a.start as start,
                        a.end as end,
                        a.active,
                        a.type,
                        at.desc AS booking_type_desc,
                        at.lbl AS booking_type_lbl,
                        at.calendar_style AS calendar_style,
                        at.member_rebookable AS member_rebookable,
                        at.same_day_only AS same_day_only,
                        at.min_participant AS min_participant,
                        a.bumpable,
                        a.created,
                        a.updated,
                        a.notes,
                        a.id,
                        MD5(a.updated) AS etag,
                        c.name as court_name,
                        cl.time_zone,
                        cl.id as club_id
                    FROM
                        activity a
                            JOIN
                        court c ON a.court = c.id
                            JOIN
                        club cl ON cl.id = c.club
                            JOIN
                        activity_type at ON at.id = a.type
                    WHERE
                        a.id = ? and cl.id = ?`;

// Membership date predicates belong on the LEFT JOIN so participants
// without a membership covering the booking date still appear (public_label null).
const player_q = `SELECT 
                        activity, 
                        person as person_id, 
                        p.firstname, 
                        p.lastname,
                        participant.type as player_type_id, 
                        pt.lbl as player_type_lbl,
                        pt.desc as player_type_desc,
                        rt.public_label as club_role_public_label
                FROM
                    participant
                        JOIN
                    person p ON p.id = participant.person
                        JOIN
                    participant_type pt ON pt.id = participant.type
                        LEFT JOIN membership m
                          ON m.person_id = participant.person
                          AND ? >= m.valid_from
                          AND ? < m.valid_until
                        LEFT JOIN role r ON r.id = m.role
                        LEFT JOIN role_type rt ON rt.id = r.type
                WHERE 
                    activity = ?`;

                

// Named placeholders (mysql2 namedPlaceholders) — same value reused under one name.
const booking_time_q = `SELECT 
                            UNIX_TIMESTAMP(CONVERT_TZ(CONCAT(:date,' ',:start),time_zone,@@GLOBAL.time_zone)) DIV 1 AS utc_start,
                            UNIX_TIMESTAMP(CONVERT_TZ(CONCAT(:date,' ',:end),time_zone,@@GLOBAL.time_zone)) DIV 1 AS utc_end,
                            UNIX_TIMESTAMP(CONVERT_TZ(:date,time_zone,@@GLOBAL.time_zone)) DIV 1 AS utc_day_start,
                            UNIX_TIMESTAMP(NOW()) AS utc_req_time,
                            CAST(CONVERT_TZ(NOW(), @@GLOBAL.time_zone, time_zone) AS DATE) + 0 AS loc_req_date,
                            CAST(CONVERT_TZ(NOW(), @@GLOBAL.time_zone, time_zone) AS TIME) AS loc_req_time,
                            CAST(:date AS DATE) + 0 AS numeric_date,
                            time_zone,
                            s.id AS schedule_id
                        FROM
                            club
                        LEFT JOIN
                            (SELECT 
                                csi.id, cs.club
                            FROM
                                club_schedule cs
                            JOIN court_schedule_item csi ON csi.schedule = cs.id
                            WHERE
                                cs.club = :club_id
                                    AND :date BETWEEN cs.from AND cs.to
                                    AND csi.dayofweek = DAYOFWEEK(:date)
                                    AND :start >= csi.open
                                    AND close >= :end
                                    AND csi.court = :court_id) AS s ON s.club = club.id
                            WHERE
                                club.id = :club_id`;

//end,start,court,date
const overlap_check_q = `
    SELECT 
    id
    FROM
    activity
    WHERE
    ? > start
    AND ? < end
    AND court = ?
    AND date = ?
    AND active = 1 FOR UPDATE`;




/**
 * 
 * @param {*} connection 
 * @param {Number} id Booking id 
 * @param {Number} t_type Type of transaction the query is running in
 * 
 */
async function getBooking(connection, id, t_type = transactionType.NO_TRANSACTION) {

    const booking_result = await sqlconnector.runQuery(connection, formatQuery(booking_q,t_type), [id, CLUB_ID]);

    if (!Array.isArray(booking_result) || booking_result.length === 0) {
        return null;
    }

    const bookingDate = booking_result[0]['date'];

    // Param order matches player_q placeholders: valid_from, valid_until, activity id
    const players_result = await sqlconnector.runQuery(
        connection,
        formatQuery(player_q, t_type),
        [bookingDate, bookingDate, id]
    );

    if (!Array.isArray(players_result)) {
        return null;
    }

    const booking = {
        id: booking_result[0]['id'],
        utc_start: booking_result[0]['utc_start'],
        utc_end: booking_result[0]['utc_end'],
        utc_day_start: booking_result[0]['utc_day_start'],
        utc_req_time: booking_result[0]['utc_req_time'],
        loc_req_date: booking_result[0]['loc_req_date'],
        loc_req_time: booking_result[0]['loc_req_time'],
        utc_created: booking_result[0]['utc_created'],
        utc_updated: booking_result[0]['utc_updated'],
        date: booking_result[0]['date'],
        numeric_date: booking_result[0]['numeric_date'],
        start: booking_result[0]['start'],
        end: booking_result[0]['end'],
        active: booking_result[0]['active'],
        type: booking_result[0]['type'],
        booking_type_desc: booking_result[0]['booking_type_desc'],
        booking_type_lbl: booking_result[0]['booking_type_lbl'],
        calendar_style: booking_result[0]['calendar_style'],
        member_rebookable: booking_result[0]['member_rebookable'],
        same_day_only: booking_result[0]['same_day_only'],
        min_participant: booking_result[0]['min_participant'],
        bumpable: booking_result[0]['bumpable'],
        created: booking_result[0]['created'],
        updated: booking_result[0]['updated'],
        notes: booking_result[0]['notes'],
        etag: booking_result[0]['etag'],
        court_id: booking_result[0]['court_id'],
        court_name: booking_result[0]['court_name'],
        time_zone: booking_result[0]['time_zone'],
        club_id: booking_result[0]['club_id'],
        players: [],
        permissions: []
    }

    players_result.forEach(pinfo => {
        // Guard against overlapping membership rows duplicating a participant
        if (booking.players.some((p) => p.person_id === pinfo.person_id)) {
            return;
        }

        booking.players.push({
            person_id: pinfo['person_id'],
            firstname: pinfo['firstname'],
            lastname: pinfo['lastname'],
            player_type_id: pinfo['player_type_id'],
            player_type_lbl: pinfo['player_type_lbl'],
            player_type_desc: pinfo['player_type_desc'],
            club_role_public_label: pinfo['club_role_public_label'],
        });
    });

    return booking;

}

/**
 * 
 * @param {*} connection Mysql connection object
 * @param {*} bookinginfo Booking info object
 * 
 * This function does the actual insert to the datbase. Must be called within a transaction.
 */
async function insertBooking(connection, booking) {

    const insertActivityQ = `INSERT INTO \`activity\` (\`type\`, \`court\`, \`date\`, \`start\`, \`end\`, \`bumpable\`, \`active\`, \`notes\`)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?)`;

    const insertPlayersQ =
        "INSERT INTO participant (`activity`, `person`, `status`, `type`) VALUES ?";

    const activity_result = await sqlconnector.runQuery(connection, insertActivityQ, [booking.type, booking.court_id, booking.date, booking.start, booking.end, booking.bumpable, booking.notes])

    const activity_id = activity_result.insertId;

    const playersArrays = booking.players.map((player) => [
        activity_id,
        player.person_id,
        1,
        player.player_type_id,
    ]);

    await sqlconnector.runQuery(connection, insertPlayersQ, [playersArrays])

    return activity_id;
}

/**
 * 
 * @param {*} connection 
 * @param {*} initValues 
 * 
 * Get a fresh booking. Must be run within a transaction
 */
async function getNewBooking(connection, initValues) {

    if (!initValues) {
        return null
    }

    const booking = {
        court_id: initValues.court,
        start: initValues.start,
        date: initValues.date,
        end: initValues.end,
        notes: initValues.notes,
        bumpable: initValues.bumpable,
        type: initValues.type,
        players: Array.from(initValues.players),
        active: 1,
        utc_created: null,
        utc_updated: null,
        etag: null
    }

    // Type must exist and be enabled for this club; effective min via COALESCE
    const activity_type_q = `SELECT
                                at.\`desc\` AS booking_type_desc,
                                at.lbl AS booking_type_lbl,
                                at.calendar_style,
                                at.member_rebookable,
                                at.same_day_only,
                                COALESCE(ac.min_participant, at.min_participant) AS min_participant
                             FROM activity_type at
                             JOIN activity_club ac ON ac.activity_type_id = at.id
                             WHERE at.id = ?
                               AND ac.club_id = ?
                             LOCK IN SHARE MODE`;

    const activity_type_result = await sqlconnector.runQuery(
        connection,
        activity_type_q,
        [booking.type, CLUB_ID]
    );

    if (!Array.isArray(activity_type_result) || activity_type_result.length !== 1) {
        return null
    }

    booking.booking_type_desc = activity_type_result[0].booking_type_desc;
    booking.booking_type_lbl = activity_type_result[0].booking_type_lbl;
    booking.calendar_style = activity_type_result[0].calendar_style;
    booking.member_rebookable = activity_type_result[0].member_rebookable;
    booking.same_day_only = activity_type_result[0].same_day_only;
    booking.min_participant = activity_type_result[0].min_participant;

    let bookingtime_result = await sqlconnector.runQuery(connection, booking_time_q, {
        date: booking.date,
        start: booking.start,
        end: booking.end,
        club_id: CLUB_ID,
        court_id: booking.court_id,
    });

    if (bookingtime_result.length !== 1) {
        return null
    }

    booking.numeric_date = bookingtime_result[0].numeric_date;
    booking.utc_start = bookingtime_result[0].utc_start;
    booking.utc_end = bookingtime_result[0].utc_end;
    booking.utc_day_start = bookingtime_result[0].utc_day_start;
    booking.utc_req_time = bookingtime_result[0].utc_req_time;
    booking.loc_req_date = bookingtime_result[0].loc_req_date;
    booking.loc_req_time = bookingtime_result[0].loc_req_time;
    booking.time_zone = bookingtime_result[0].time_zone;
    booking.schedule_id = bookingtime_result[0].schedule_id;


    return booking;

}

/**
 * 
 * @param {*} connection 
 * @param { string } end 
 * @param { string } start 
 * @param { number } court_id 
 * @param { string } date 
 * @returns { number [] }  An array of overlapping booking ids
 */
async function checkOverlap(connection, end, start, court_id, date) {

    const overlap_result = await sqlconnector.runQuery(connection, overlap_check_q, [end, start, court_id, date]);

    if (!Array.isArray(overlap_result)) {
        throw new Error("Unable to check booking overlap");
    }

    return overlap_result.map((res) => res.id);

}


module.exports = {
    getBooking,
    insertBooking,
    getNewBooking,
    checkOverlap,
}
