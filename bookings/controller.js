const sqlconnector = require("../db/SqlConnector");
const { checkPermission } = require("./permissions/BookingPermissions");
const { getProcessor } = require("./command");
const MatchCommandProcessors = require("./processor");
const SQLErrorFactory = require("./../utils/SqlErrorFactory");
const RESTError = require("./../utils/RESTError");
const {
  getNewBooking,
  insertBooking,
  checkOverlap,
  getBooking,
} = require("./BookingUtils");
const { transactionType } = require("../utils/dbutils");
const { log, appLogLevels } = require('./../utils/logger/logger');

const CLUB_ID = process.env.CLUB_ID;

/**
 * Retrieves bookings for a specific date.
 *
 * @param {string} date - The date (YYYY-MM-DD) for which to retrieve bookings.
 * @returns {Promise<Array>} - A promise that resolves to an array of bookings.
 * @throws {Error} - If there is an error retrieving the bookings.
 */
async function getBookingsForDate(date) {
  const OPCODE = "GET_BOOKINGS_FOR_DATE";

  if (date === null) return [];

  const connection = await sqlconnector.getConnection();

  // Membership date predicates belong on the LEFT JOIN so participants
  // without a membership covering `date` still appear (role fields null).
  const player_query = `SELECT
        p.activity,
        p.person as person_id,
        p.type as player_type_id,
        p.status,
        person.firstname,
        person.lastname,
        m.role as person_role_id,
        r.lbl as person_role_label,
        r.type as person_role_type_id,
        rt.label as person_role_type_label,
        rt.requires_pass as person_requires_pass
      FROM participant p
      JOIN person on person.id = p.person
      LEFT JOIN membership m
        ON m.person_id = p.person
        AND ? >= m.valid_from
        AND ? < m.valid_until
      LEFT JOIN role r on r.id = m.role
      LEFT JOIN role_type rt on rt.id = r.type
      WHERE p.activity in ( ? )
      ORDER BY activity FOR SHARE`;

  const activity_query = `SELECT
                                activity.id,
                                court,
                                bumpable,
                                DATE_FORMAT(date, '%Y-%m-%d') AS date,
                                end,
                                start,
                                TIME_TO_SEC(start) DIV 60 AS start_min,
                                TIME_TO_SEC(end) DIV 60 AS end_min,
                                type,
                                created,
                                updated,
                                notes,
                                at.desc AS booking_type_desc,
                                at.group AS group_id,
                                ag.utility_factor AS utility
                            FROM
                                activity
                                    JOIN
                                activity_type at ON at.id = activity.type
                                    JOIN
                                activity_group ag ON at.group = ag.id
                                    JOIN
                                court c ON c.id = activity.court
                                    JOIN
                                club cl ON c.club = cl.id
                            WHERE
                                date = ?
                                AND active = 1
                                AND cl.id = ?
                            FOR SHARE`;

  try {
    await sqlconnector.runQuery(connection, "START TRANSACTION READ ONLY", []);

    let bookings_array;
    let players_array = [];

    try {
      bookings_array = await sqlconnector.runQuery(
        connection,
        activity_query,
        [date, CLUB_ID]
      );

      if (bookings_array.length > 0) {
        const booking_ids = bookings_array.map((element) => element.id);

        // Param order matches player_query placeholders: valid_from, valid_until, activity ids
        players_array = await sqlconnector.runQuery(
          connection,
          player_query,
          [date, date, booking_ids]
        );
      }

      await sqlconnector.runQuery(connection, "COMMIT", []);
    } catch (error) {
      try {
        await sqlconnector.runQuery(connection, "ROLLBACK", []);
      } catch (rollbackError) {
        log(
          appLogLevels.ERROR,
          `Rollback failed after read bookings error: ${rollbackError.message}`
        );
      }
      throw error;
    }

    if (bookings_array.length === 0) {
      return [];
    }

    // Assemble response after commit so in-memory work cannot trigger a rollback
    const bookings = new Map();

    bookings_array.forEach((element) => {
      bookings.set(element.id, {
        id: element.id,
        court: element.court,
        bumpable: element.bumpable,
        date: element.date,
        end: element.end,
        start: element.start,
        start_min: element.start_min,
        end_min: element.end_min,
        type: element.type,
        notes: element.notes,
        updated: element.updated,
        created: element.created,
        players: [],
        booking_type_desc: element.booking_type_desc,
        group_id: element.group_id,
        utility: element.utility,
      });
    });

    players_array.forEach((player) => {
      const activity = bookings.get(player.activity);
      if (!activity) {
        return;
      }

      // Guard against overlapping membership rows duplicating a participant
      if (activity.players.some((p) => p.person_id === player.person_id)) {
        return;
      }

      activity.players.push({
        person_id: player.person_id,
        type_id: player.player_type_id,
        status: player.status,
        firstname: player.firstname,
        lastname: player.lastname,
        person_role_id: player.person_role_id,
        person_role_type_id: player.person_role_type_id,
        person_role_label: player.person_role_label,
        person_role_type_label: player.person_role_type_label,
        person_requires_pass: player.person_requires_pass,
      });
    });

    return Array.from(bookings.values());
  } catch (error) {
    log(appLogLevels.ERROR, `Unable to read bookings: ${error.message}`);
    throw error instanceof RESTError
      ? error
      : new SQLErrorFactory.getError(OPCODE, error);
  } finally {
    connection.release();
  }
}

/**
 *
 * @param { Request } request
 */
async function addBooking(request) {
  const OPCODE = "ADD_BOOKING";

  const players = request.body.players;
  const booking_date = request.body.date;

  //Initialize a hashmap to store player ids and roles
  const playerTypeMap = new Map();

  players.forEach((player) => {
    playerTypeMap.set(player.id, player.type);
  });

  //START Check unique players
  const uniqueIds = Array.from(playerTypeMap.keys());

  if (uniqueIds.length !== players.length) {
    throw new RESTError(422, "Duplicate players found");
  }
  //END

  const person_check_q = `SELECT p.id,m.role 
                          FROM clubhouse.person p 
                          JOIN club c on c.id = p.club
                          LEFT JOIN membership m on m.person_id = p.id
                          WHERE p.id IN ? 
                          AND p.club = ?
                          AND ? >= m.valid_from 
                          AND ? < m.valid_until 
                          LOCK IN SHARE MODE`;

  const connection = await sqlconnector.getConnection();

  try {
    await sqlconnector.runQuery(connection, "START TRANSACTION READ WRITE", []);

    try {
      //START Check players
      const persons_result = await sqlconnector.runQuery(
        connection,
        person_check_q,
        [[uniqueIds], CLUB_ID,booking_date,booking_date]
      );

      if (
        !(
          Array.isArray(persons_result) &&
          persons_result.length === uniqueIds.length
        )
      ) {
        throw new RESTError(422, "Person(s) not found");
      }

      const initValues = {
        court: request.body.court,
        start: request.body.start,
        date: request.body.date,
        end: request.body.end,
        notes: request.body.note,
        bumpable: request.body.bumpable,
        type: request.body.type,
      };

      initValues.players = persons_result.map((person) => ({
        person_id: person.id,
        member_role_id: person.role,
        player_type_id: playerTypeMap.get(person.id),
      }));

      const booking = await getNewBooking(connection, initValues);

      if (!booking) {
        log(appLogLevels.ERROR, `Unable to create a new booking. Values ${JSON.stringify(initValues)}`);
        throw new RESTError(500, "Unable to create a new booking");
      }

      //Check permissions
      const errors = checkPermission("create", booking);

      if (errors.length > 0) {
        log(appLogLevels.ERROR, `Booking permission denied. Booking: ${JSON.stringify(booking)} Error: ${errors[0]}`);
        throw new RESTError(422, "Create permission denied: " + errors[0]);
      }

      //START Check for overlapping bookings
      const overlapping_bookings = await checkOverlap(
        connection,
        booking.end,
        booking.start,
        booking.court_id,
        booking.date
      );

      if (overlapping_bookings.length !== 0) {
        const overlap_record = {
          booking_date: booking.date,
          booking_start: booking.start,
          booking_end: booking.end,
          booking_court_id: booking.court_id,
          overlapping_ids: Array.from(overlapping_bookings),
        };

        log(appLogLevels.WARNING, `Booking overlap found: ${JSON.stringify(overlap_record)}`);
        throw new RESTError(422, "Booking overlap found.");
      }
      //END

      await insertBooking(connection, booking);

      await sqlconnector.runQuery(connection, "COMMIT", []);

      log(appLogLevels.INFO, `Booking added: ${JSON.stringify(booking)}`);
    } catch (error) {
      await sqlconnector.runQuery(connection, "ROLLBACK", []);
      throw error;
    }
  } catch (error) {

    throw error instanceof RESTError
      ? error
      : new SQLErrorFactory.getError(OPCODE, error);
  } finally {
    connection.release();
  }
}

/**
 *
 * @param { Number } Session id
 */
async function getBookingData(id) {
  const OPCODE = "GET_BOOKING";

  const connection = await sqlconnector.getConnection();

  try {
    await sqlconnector.runQuery(connection, "START TRANSACTION", []);

    const booking = await getBooking(connection, id, transactionType.READ_TRANSACTION);

    await sqlconnector.runQuery(connection, "COMMIT", []);

    if (!booking) {
      log(appLogLevels.ERROR, `Booking ${id} not found`);
      throw new RESTError(404, "Booking not found");
    }

    return booking;
  } catch (error) {
    console.log(error);
    throw error instanceof RESTError
      ? error
      : new SQLErrorFactory.getError(OPCODE, error);
  } finally {
    connection.release();
  }
}

/**
 *
 * @param { Number } id Id of the object being processed
 * @param { Object } cmd
 */
function processPatchCommand(id, cmd) {
  const processor_name = getProcessor(cmd.name);

  if (typeof MatchCommandProcessors[processor_name] === "function")
    return MatchCommandProcessors[processor_name](id, cmd.params);
  else return Promise.reject(new Error("Unable to run command"));
}

/**
 *
 * @param { Number } court
 * @param { String } date
 * @param { String } start
 * @param { String } end
 */

async function getOverlappingBookings(court, date, start, end) {
  const overlap_q = `SELECT a.id,DATE_FORMAT(date,"%Y-%m-%d" ) as date,start,end,a.court,c.name as court_name FROM activity a JOIN court c ON a.court = c.id WHERE ? > start AND ? < end AND court = ? AND date = ? AND active = 1`;

  const connection = await sqlconnector.getConnection();

  try {
    const overlapping_result = await sqlconnector.runQuery(
      connection,
      overlap_q,
      [end, start, court, date]
    );

    return overlapping_result.map((booking) => {
      return {
        id: booking["id"],
        date: booking["date"],
        start: booking["start"],
        end: booking["end"],
        court: booking["court"],
        court_name: booking["court_name"],
      };
    });
  } catch (err) {
    throw new RESTError(500, "Error querying database");
  } finally {
    connection.release();
  }
}

/**
 *
 * @param {String} date
 * @param {String} start
 * @param {String} end
 */
async function getCourtAvailability(date, start, end) {
  const availability_q = `
    SELECT
      c.id AS court_id,
      c.name AS court_name,
      a.id AS booking_id,
      DATE_FORMAT(a.date,"%Y-%m-%d") AS date,
      a.start,
      a.end
    FROM court c
    LEFT JOIN activity a
      ON a.court = c.id
      AND ? > a.start
      AND ? < a.end
      AND a.date = ?
      AND a.active = 1
    WHERE c.club = ?
    ORDER BY c.id, a.start, a.end
  `;

  const connection = await sqlconnector.getConnection();

  try {
    const availability_result = await sqlconnector.runQuery(
      connection,
      availability_q,
      [end, start, date, CLUB_ID]
    );

    const availability_map = new Map();

    availability_result.forEach((row) => {
      if (!availability_map.has(row.court_id)) {
        availability_map.set(row.court_id, {
          court: row.court_id,
          court_name: row.court_name,
          has_overlap: false,
          overlaps: [],
        });
      }

      if (row.booking_id !== null) {
        const courtAvailability = availability_map.get(row.court_id);
        courtAvailability.has_overlap = true;
        courtAvailability.overlaps.push({
          id: row.booking_id,
          date: row.date,
          start: row.start,
          end: row.end,
          court: row.court_id,
          court_name: row.court_name,
        });
      }
    });

    return Array.from(availability_map.values());
  } catch (err) {
    throw new RESTError(500, "Error querying database");
  } finally {
    connection.release();
  }
}

module.exports = {
  addBooking,
  getBookingData,
  processPatchCommand,
  getBookingsForDate,
  getOverlappingBookings,
  getCourtAvailability,
};
