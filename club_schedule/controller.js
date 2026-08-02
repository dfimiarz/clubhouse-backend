const sqlconnector = require('../db/SqlConnector');
const RESTError = require('./../utils/RESTError');
const { getJSON, storeJSON } = require('./../db/RedisConnector')
const { log, appLogLevels } = require('./../utils/logger/logger');
const CLUB_ID = process.env.CLUB_ID;

/**
 * 
 * @param {Number[]} courts 
 * @param {Map<Number,Object>} openTimeFramesDayMap 
 * @param {Map<Number,Object>} calTimesDayMap 
 * @returns 
 */
function getClosedTimeFrames(courts, openTimeFramesDayMap, calTimesDayMap) {
    /**
     * Loop through all days of week and find inactive_time_frames
     */
    return [1, 2, 3, 4, 5, 6, 7].reduce((prev_array, day) => {

        const daily_open_time_frames = openTimeFramesDayMap.get(day);
        const { calStartMin, calEndMin } = calTimesDayMap.get(day);

        prev_array.push({
            dayofweek: day,
            time_frames: getClosedTimeFramesForDay(courts, daily_open_time_frames, calStartMin, calEndMin)
        });

        return prev_array;
    }, [])


}

/**
 * 
 * @param {Object[]} items Schedule items
 * @param {Number} ds default start min
 * @param {Number} de default end min
 * @returns Number
 */
function getCalStartMin(items, ds, de) {
    /**
     * Not itmes return ds, otherwise loop through sorted array and find the first start time
     */
    return items.length === 0 ? ds : items.reduce((prev, curr) => (curr.open_min <= prev ? curr.open_min : prev), de);
}

/**
 * 
 * @param {Object[]} items Sorted calander items
 * @param {Number} ds Default start min
 * @param {Number} de Default end min
 * @returns Number
 */
function getCalEndMin(items, ds, de) {
    /**
     * Not itmes return de, otherwise loop through sorted array and find the last end time
     */
    return items.length == 0 ? de : items.reduce((prev, curr) => (curr.close_min >= prev ? curr.close_min : prev), ds);
}

/**
 * 
 * @param {Number[]} courts Court IDs
 * @param {Object[]} open_sessions An array of sorted open sessions in a day 
 * @param {Number} calendar_start_min Calendar start min
 * @param {Number} calendar_end_min Calendar end min
 * @returns Object[] An array of closed timeframes
 */
function getClosedTimeFramesForDay(courts, open_sessions, calendar_start_min, calendar_end_min) {

    const calStartHour = Math.floor(calendar_start_min / 60);

    const calEndHour = Math.ceil(calendar_end_min / 60);

    //Add all courts to inactiveCourts
    let closedCourts = new Set(courts);

    //Initialize variables
    let closed_time_frames = [];
    let last_close_min = null;
    let last_court = null;

    open_sessions.forEach((timeframe) => {
        //Check if court is in the set of inactive courts
        if (closedCourts.has(timeframe.court)) {
            //If so remove court from inactive court set
            closedCourts.delete(timeframe.court);
        }

        //Is last court different from current court?
        if (last_court !== timeframe.court) {
            /*If last court not null and calEndHour > last_close_min,
             *switching courts so add last inactive time frame for this court
             */
            if (last_court !== null && calEndHour * 60 > last_close_min) {
                closed_time_frames.push({
                    court_id: last_court,
                    start: last_close_min,
                    end: calEndHour * 60,
                });
            }
            last_close_min = calStartHour * 60;
        }

        if (timeframe.open_min > last_close_min) {
            closed_time_frames.push({
                court_id: timeframe.court,
                start: last_close_min,
                end: timeframe.open_min,
            });
        }

        last_close_min = timeframe.close_min;
        last_court = timeframe.court;

    });

    /**
     * At the end, check if there if there is one more closed_time_frame left after 
     * the last open session
     */
    if (last_close_min < calEndHour * 60) {
        closed_time_frames.push({
            court_id: last_court,
            start: last_close_min,
            end: calEndHour * 60,
        });
    }

    /* Loop through all inactive courts and add inactive time frames
     * between calStartHour and calEndHour
     */
    Array.from(closedCourts).forEach((val) => {
        closed_time_frames.push({
            court_id: val,
            start: calStartHour * 60,
            end: calEndHour * 60,
        });
    });

    //console.log(calStartHour, calEndHour, open_sessions, closed_time_frames);

    return closed_time_frames;
}

/**
 * Retrieves a list of club schedules for a given club_id
 */
async function getClubSchedules() {

    //Check redis cache
    const redisKey = `club_schedules_${CLUB_ID}`;
    let cachedSchedule = null;

    //Check redis cache
    try {
        cachedSchedule = await getJSON(redisKey);
    }
    catch (error) {
        log(appLogLevels.ERROR, `Error retrieving club schedules from cache: ${error}`)
    }

    if (cachedSchedule) {
        //console.debug("Returning club schedules from cache", redisData);
        return cachedSchedule;
    }

    const courts_for_club_query = `SELECT id FROM court WHERE club = ? FOR SHARE`;

    const club_schedule_query = `SELECT cs.id,
                                    cs.club,
                                    cs.name,
                                    DATE_FORMAT(\`from\`,"%Y-%m-%d") as \`from\`,
                                    DATE_FORMAT(\`to\`,"%Y-%m-%d") as \`to\`,
                                    UNIX_TIMESTAMP(CONVERT_TZ(\`from\`,c.time_zone,@@GLOBAL.time_zone)) AS from_ms,
                                    UNIX_TIMESTAMP(CONVERT_TZ(\`to\`,c.time_zone,@@GLOBAL.time_zone)) AS to_ms,
                                    time_to_sec(default_cal_start) DIV 60 as default_start_min,
                                    time_to_sec(default_cal_end) DIV 60 as default_end_min
                                FROM 
                                    club_schedule cs
                                JOIN club c on c.id = cs.club
                                WHERE cs.club = ? 
                                ORDER by \`from\`
                                FOR SHARE`;

    const schedule_items_query = `SELECT
                                    schedule,
                                    court,
                                    dayofweek,
                                    open,
                                    close,
                                    time_to_sec(open) DIV 60 as open_min,
                                    time_to_sec(close) DIV 60 as close_min,
                                    message
                                FROM
                                    court_schedule_item
                                WHERE court in (SELECT id FROM court where club = ?)
                                ORDER BY schedule,dayofweek, court, open
                                FOR SHARE`;

    try {
        const { courts_results, schedules_result, item_result } =
            await sqlconnector.withTransaction(async (connection) => {
                const courts_results = await sqlconnector.runExecute(
                    connection,
                    courts_for_club_query,
                    [CLUB_ID]
                );
                const schedules_result = await sqlconnector.runExecute(
                    connection,
                    club_schedule_query,
                    [CLUB_ID]
                );
                const item_result = await sqlconnector.runExecute(
                    connection,
                    schedule_items_query,
                    [CLUB_ID]
                );
                return { courts_results, schedules_result, item_result };
            });

        //Extract court ids into a set;
        const courts = courts_results.map((court_result) => court_result.id);

        const result = schedules_result.map((schedule) => {

            /**
             * Holds open time frames for each day of a week
             */
            const openTimeFramesDayMap = new Map();

            /**
             * Holds start and end min for each day of a week
             */
            const calTimesDayMap = new Map();

            const open_time_frames = item_result.filter((item) => item.schedule === schedule["id"]);

            [1, 2, 3, 4, 5, 6, 7].forEach((day) => {
                //Get timeframes for each day
                const timeframes = open_time_frames.filter((otf) => otf.dayofweek === day);
                const calStartMin = getCalStartMin(timeframes, schedule["default_start_min"], schedule["default_end_min"]);
                const calEndMin = getCalEndMin(timeframes, schedule["default_start_min"], schedule["default_end_min"]);
                openTimeFramesDayMap.set(day, timeframes);
                calTimesDayMap.set(day, { calStartMin: calStartMin, calEndMin: calEndMin });
            })

            const closed_time_frames = getClosedTimeFrames(courts, openTimeFramesDayMap, calTimesDayMap);

            return {
                id: schedule["id"],
                club: schedule["club"],
                name: schedule["name"],
                from: schedule["from"],
                from_ms: schedule["from_ms"],
                to: schedule["to"],
                to_ms: schedule["to_ms"],
                default_start_min: schedule["default_start_min"],
                default_end_min: schedule["default_end_min"],
                open_time_frames: open_time_frames,
                closed_time_frames: closed_time_frames,
                calTimes: Array.from(calTimesDayMap).reduce((array, [day, times]) => {
                    array.push({ dayofweek: day, calStartMin: times.calStartMin, calEndMin: times.calEndMin })
                    return array;
                }, [])
            }
        });


        try {
            //store to redis
            await storeJSON(redisKey, result);
        }
        catch (error) {
            log(appLogLevels.ERROR, `Error storing club schedules to cache: ${error}`)
        }

        return result;


    }
    catch (error) {
        log(appLogLevels.ERROR, `Error retrieving club schedules: ${error}`);
        throw new RESTError(500, "Failed fetching club schedules");
    }

}

module.exports = {
    getClubSchedules
}
