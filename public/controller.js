const sqlconnector = require("../db/SqlConnector");
const clubcontroller = require("../club/controller");
const schedulecontroller = require("../club_schedule/controller");
const RESTError = require("../utils/RESTError");
const { log, appLogLevels } = require("../utils/logger/logger");

const CLUB_ID = process.env.CLUB_ID;

/**
 * Allow-listed public booking row. Occupancy, catalog label, and the fields
 * the visitor calendar needs to pick match / lesson / event styling.
 * Do not copy fields off the authenticated shape.
 *
 * @param {object} row
 * @returns {object}
 */
function toPublicBooking(row) {
  const booking = {
    court: row.court,
    date: row.date,
    start: row.start,
    end: row.end,
    start_min: Number(row.start_min),
    end_min: Number(row.end_min),
    status: "busy",
  };

  const desc =
    typeof row.booking_type_desc === "string" ? row.booking_type_desc.trim() : "";
  const lbl =
    typeof row.booking_type_lbl === "string" ? row.booking_type_lbl.trim() : "";
  if (lbl) {
    booking.booking_type_desc = lbl;
  } else if (desc) {
    booking.booking_type_desc = desc;
  }

  const style =
    typeof row.calendar_style === "string" ? row.calendar_style.trim() : "";
  if (style) {
    booking.calendar_style = style;
  }

  const utility = Number(row.utility);
  if (Number.isFinite(utility)) {
    booking.utility = utility;
  }

  return booking;
}

async function getPublicCourts() {
  const query = "SELECT id, name FROM court WHERE club = ? ORDER BY id";

  try {
    return await sqlconnector.withConnection(async (connection) => {
      return sqlconnector.runExecute(connection, query, [CLUB_ID]);
    });
  } catch (error) {
    log(appLogLevels.ERROR, `Error retrieving public courts: ${error.message}`);
    throw new RESTError(500, "Failed fetching courts");
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
  const today = await clubcontroller.getClubLocalToday();

  if (date !== today) {
    throw new RESTError(403, "Public schedule is only available for today");
  }

  const query = `
    SELECT
      court,
      DATE_FORMAT(date, '%Y-%m-%d') AS date,
      start,
      end,
      TIME_TO_SEC(start) DIV 60 AS start_min,
      TIME_TO_SEC(end) DIV 60 AS end_min,
      at.desc AS booking_type_desc,
      at.lbl AS booking_type_lbl,
      at.calendar_style AS calendar_style,
      ag.utility_factor AS utility
    FROM activity
    JOIN court c ON c.id = activity.court
    JOIN activity_type at ON at.id = activity.type
    JOIN activity_group ag ON at.\`group\` = ag.id
    WHERE date = ?
      AND active = 1
      AND c.club = ?
    ORDER BY court, start, end
  `;

  try {
    const bookings = await sqlconnector.withConnection(async (connection) => {
      return sqlconnector.runExecute(connection, query, [date, CLUB_ID]);
    });

    return bookings.map(toPublicBooking);
  } catch (error) {
    log(appLogLevels.ERROR, `Error retrieving public bookings: ${error.message}`);
    throw new RESTError(500, "Failed fetching bookings");
  }
}

module.exports = {
  getPublicCourts,
  getPublicClubSchedules,
  getPublicBookingsForDate,
  toPublicBooking,
};
