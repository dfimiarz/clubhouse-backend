const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
const sqlconnector = require("../db/SqlConnector");
const clubcontroller = require("../club/controller");
const schedulecontroller = require("../club_schedule/controller");
const RESTError = require("../utils/RESTError");
const { log, appLogLevels } = require("../utils/logger/logger");

dayjs.extend(utc);
dayjs.extend(timezone);

const CLUB_ID = process.env.CLUB_ID;

async function getPublicCourts() {
  const connection = await sqlconnector.getConnection();
  const query = "SELECT id, name FROM court WHERE club = ? ORDER BY id";

  try {
    return await sqlconnector.runQuery(connection, query, [CLUB_ID]);
  } catch (error) {
    log(appLogLevels.ERROR, `Error retrieving public courts: ${error.message}`);
    throw new RESTError(500, "Failed fetching courts");
  } finally {
    connection.release();
  }
}

async function getPublicClubSchedules() {
  const schedules = await schedulecontroller.getClubSchedules();

  return schedules.map((schedule) => ({
    id: schedule.id,
    name: schedule.name,
    from: schedule.from,
    from_ms: schedule.from_ms,
    to: schedule.to,
    to_ms: schedule.to_ms,
    default_start_min: schedule.default_start_min,
    default_end_min: schedule.default_end_min,
    closed_time_frames: schedule.closed_time_frames,
    calTimes: schedule.calTimes,
  }));
}

async function getPublicBookingsForDate(date) {
  const { time_zone } = await clubcontroller.getClubInfo();
  const today = dayjs().tz(time_zone).format("YYYY-MM-DD");

  if (date !== today) {
    throw new RESTError(403, "Public schedule is only available for today");
  }

  const connection = await sqlconnector.getConnection();
  const query = `
    SELECT
      court,
      DATE_FORMAT(date, '%Y-%m-%d') AS date,
      start,
      end,
      TIME_TO_SEC(start) DIV 60 AS start_min,
      TIME_TO_SEC(end) DIV 60 AS end_min
    FROM activity
    JOIN court c ON c.id = activity.court
    WHERE date = ?
      AND active = 1
      AND c.club = ?
    ORDER BY court, start, end
  `;

  try {
    const bookings = await sqlconnector.runQuery(connection, query, [date, CLUB_ID]);

    return bookings.map((booking) => ({
      court: booking.court,
      date: booking.date,
      start: booking.start,
      end: booking.end,
      start_min: booking.start_min,
      end_min: booking.end_min,
      status: "busy",
    }));
  } catch (error) {
    log(appLogLevels.ERROR, `Error retrieving public bookings: ${error.message}`);
    throw new RESTError(500, "Failed fetching bookings");
  } finally {
    connection.release();
  }
}

module.exports = {
  getPublicCourts,
  getPublicClubSchedules,
  getPublicBookingsForDate,
};
