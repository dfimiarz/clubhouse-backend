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
const clubcontroller = require("../club/controller");
const { suggestPlayerTypes, MEMBER_ACTIVITY_GROUP_ID } = require("./playerType");
const {
  assertNoConcurrentMemberBookings,
  lockRosterIfNeeded,
} = require("./playerOverlap");

const CLUB_ID = process.env.CLUB_ID;

// Club-local wall-clock end of an activity vs club-local "now".
// date+end are stored as club-local; CONVERT_TZ shifts server NOW into the club zone.
const ACTIVITY_END_DT = "TIMESTAMP(activity.date, activity.end)";
const CLUB_NOW_DT =
  "CONVERT_TZ(NOW(), @@GLOBAL.time_zone, cl.time_zone)";

/**
 * Builds optional list-filter SQL for getBookingsForDate.
 * Exported for unit tests.
 *
 * @param {string} date - Requested date (YYYY-MM-DD).
 * @param {Object} [filters]
 * @returns {{ datePredicate: string, dateParams: Array, filterPredicates: string[], filterParams: Array }}
 */
function buildBookingListFilters(date, filters = {}) {
  const filterPredicates = [];
  const filterParams = [];
  const hasEndedWindow =
    filters.endedMinAgo != null || filters.endedMaxAgo != null;

  if (filters.rebookable) {
    filterPredicates.push("AND at.member_rebookable = 1");
  }

  if (filters.groupId != null) {
    filterPredicates.push("AND at.group = ?");
    filterParams.push(filters.groupId);
  }

  if (filters.endedMaxAgo != null) {
    // end <= now also excludes sessions still in progress
    filterPredicates.push(
      `AND ${ACTIVITY_END_DT} <= ${CLUB_NOW_DT}
       AND ${ACTIVITY_END_DT} >= ${CLUB_NOW_DT} - INTERVAL ? MINUTE`
    );
    filterParams.push(filters.endedMaxAgo);
  }

  if (filters.endedMinAgo != null) {
    filterPredicates.push(
      `AND ${ACTIVITY_END_DT} <= ${CLUB_NOW_DT} - INTERVAL ? MINUTE`
    );
    filterParams.push(filters.endedMinAgo);
  }

  if (filters.personIds && filters.personIds.length > 0) {
    filterPredicates.push(
      "AND EXISTS (SELECT 1 FROM participant fp WHERE fp.activity = activity.id AND fp.person IN ( ? ))"
    );
    filterParams.push(filters.personIds);
  }

  // Ended windows may span midnight; include the previous calendar day so
  // late-evening sessions remain visible shortly after 00:00.
  if (hasEndedWindow) {
    return {
      datePredicate: "date BETWEEN DATE_SUB(?, INTERVAL 1 DAY) AND ?",
      dateParams: [date, date],
      filterPredicates,
      filterParams,
    };
  }

  return {
    datePredicate: "date = ?",
    dateParams: [date],
    filterPredicates,
    filterParams,
  };
}

/**
 * Retrieves bookings for a specific date.
 *
 * @param {string} date - The date (YYYY-MM-DD) for which to retrieve bookings.
 * @param {Object} [filters] - Optional row filters; absent filters leave the query unchanged.
 * @param {boolean} [filters.rebookable] - Only bookings whose activity type has member_rebookable = 1.
 * @param {number} [filters.groupId] - Only bookings with this activity_type.group.
 * @param {number} [filters.endedMinAgo] - Only bookings that ended at least N minutes ago (club time).
 * @param {number} [filters.endedMaxAgo] - Only bookings that ended no more than N minutes ago (club time).
 * @param {number[]} [filters.personIds] - Only bookings with at least one of these participants.
 * @returns {Promise<Array>} - A promise that resolves to an array of bookings.
 * @throws {Error} - If there is an error retrieving the bookings.
 */
async function getBookingsForDate(date, filters = {}) {
  const OPCODE = "GET_BOOKINGS_FOR_DATE";

  if (date === null) return [];

  const {
    datePredicate,
    dateParams,
    filterPredicates: filter_predicates,
    filterParams: filter_params,
  } = buildBookingListFilters(date, filters);

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
        rt.requires_pass as person_requires_pass,
        rt.public_label as person_role_type_public_label
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
                                at.lbl AS booking_type_lbl,
                                at.calendar_style AS calendar_style,
                                at.member_rebookable AS member_rebookable,
                                at.same_day_only AS same_day_only,
                                at.min_participant AS min_participant,
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
                                ${datePredicate}
                                AND active = 1
                                AND cl.id = ?
                                ${filter_predicates.join("\n                                ")}
                            FOR SHARE`;

  try {
    // Fetch under a read-only transaction; assemble in memory after commit
    // so assembly bugs cannot trigger a rollback.
    const { bookings_array, players_array } = await sqlconnector.withTransaction(
      async (connection) => {
        const bookings_array = await sqlconnector.runQuery(
          connection,
          activity_query,
          [...dateParams, CLUB_ID, ...filter_params]
        );

        let players_array = [];

        if (bookings_array.length > 0) {
          const booking_ids = bookings_array.map((element) => element.id);

          // Param order matches player_query placeholders: valid_from, valid_until, activity ids
          players_array = await sqlconnector.runQuery(
            connection,
            player_query,
            [date, date, booking_ids]
          );
        }

        return { bookings_array, players_array };
      },
      { mode: "readOnly" }
    );

    if (bookings_array.length === 0) {
      return [];
    }

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
        booking_type_lbl: element.booking_type_lbl,
        calendar_style: element.calendar_style,
        member_rebookable: element.member_rebookable,
        same_day_only: element.same_day_only,
        min_participant: element.min_participant,
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
        person_role_type_public_label: player.person_role_type_public_label,
      });
    });

    return Array.from(bookings.values());
  } catch (error) {
    log(appLogLevels.ERROR, `Unable to read bookings: ${error.message}`);
    throw error instanceof RESTError
      ? error
      : new SQLErrorFactory.getError(OPCODE, error);
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

  // No person row lock here. Member writes take FOR UPDATE later;
  // SHARE now would deadlock on that upgrade.
  const person_check_q = `SELECT p.id,m.role 
                          FROM clubhouse.person p 
                          JOIN club c on c.id = p.club
                          LEFT JOIN membership m on m.person_id = p.id
                          WHERE p.id IN ? 
                          AND p.club = ?
                          AND ? >= m.valid_from 
                          AND ? < m.valid_until`;

  try {
    await sqlconnector.withTransaction(async (connection) => {

      //START Check players
      const persons_result = await sqlconnector.runQuery(
        connection,
        person_check_q,
        [[uniqueIds], CLUB_ID, booking_date, booking_date]
      );

      if (
        !(
          Array.isArray(persons_result) &&
          persons_result.length === uniqueIds.length
        )
      ) {
        throw new RESTError(422, "Person(s) not found");
      }

      const uniqueTypeIds = [...new Set(players.map((player) => Number(player.type)))];
      const participant_type_q = `SELECT id
                                  FROM participant_type
                                  WHERE id IN ?
                                  LOCK IN SHARE MODE`;
      const participant_type_result = await sqlconnector.runQuery(
        connection,
        participant_type_q,
        [[uniqueTypeIds]]
      );
      const knownTypeIds = new Set(
        (Array.isArray(participant_type_result) ? participant_type_result : []).map(
          (row) => Number(row.id)
        )
      );
      if (uniqueTypeIds.some((id) => !knownTypeIds.has(id))) {
        throw new RESTError(422, "Invalid player type");
      }

      // Type must be enabled for this club; effective min (club override or global)
      const activity_type_q = `SELECT at.id,
                                      COALESCE(ac.min_participant, at.min_participant) AS min_participant
                               FROM activity_type at
                               JOIN activity_club ac ON ac.activity_type_id = at.id
                               WHERE at.id = ?
                                 AND ac.club_id = ?
                               LOCK IN SHARE MODE`;
      const activity_type_result = await sqlconnector.runQuery(
        connection,
        activity_type_q,
        [request.body.type, CLUB_ID]
      );

      if (
        !(
          Array.isArray(activity_type_result) &&
          activity_type_result.length === 1
        )
      ) {
        throw new RESTError(422, "Invalid booking type");
      }

      const min_participant = activity_type_result[0].min_participant ?? 1;
      if (players.length < min_participant) {
        throw new RESTError(
          422,
          `Activity requires at least ${min_participant} participant${min_participant === 1 ? "" : "s"}`
        );
      }

      // Court must belong to this club and support the activity type
      const court_support_q = `SELECT 1
                               FROM activity_supported s
                               JOIN court c ON c.id = s.court
                               WHERE s.court = ?
                                 AND s.activity_type = ?
                                 AND c.club = ?
                               LOCK IN SHARE MODE`;
      const court_support_result = await sqlconnector.runQuery(
        connection,
        court_support_q,
        [request.body.court, request.body.type, CLUB_ID]
      );

      if (
        !(
          Array.isArray(court_support_result) &&
          court_support_result.length === 1
        )
      ) {
        throw new RESTError(422, "Court does not support this activity");
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

      // People before any activity FOR UPDATE (same order as CHANGE_TIME / CHANGE_COURT)
      await lockRosterIfNeeded(connection, booking);

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

      await assertNoConcurrentMemberBookings(connection, booking);

      await insertBooking(connection, booking);

      log(appLogLevels.INFO, `Booking added: ${JSON.stringify(booking)}`);
    }, { mode: "readWrite" });
  } catch (error) {
    throw error instanceof RESTError
      ? error
      : new SQLErrorFactory.getError(OPCODE, error);
  }
}

/**
 * Retrieves a single booking by id.
 *
 * @param {number|string} id - Booking id
 * @returns {Promise<Object>} Booking with players and empty permissions array
 * @throws {RESTError} 404 if the booking is not found
 */
async function getBookingData(id) {
  const OPCODE = "GET_BOOKING";

  try {
    const booking = await sqlconnector.withTransaction(
      async (connection) => {
        return getBooking(
          connection,
          id,
          transactionType.READ_TRANSACTION
        );
      },
      { mode: "readOnly" }
    );

    if (!booking) {
      log(appLogLevels.ERROR, `Booking ${id} not found`);
      throw new RESTError(404, "Booking not found");
    }

    return booking;
  } catch (error) {
    log(appLogLevels.ERROR, `Unable to read booking ${id}: ${error.message}`);
    throw error instanceof RESTError
      ? error
      : new SQLErrorFactory.getError(OPCODE, error);
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

  try {
    return await sqlconnector.withConnection(async (connection) => {
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
    });
  } catch {
    throw new RESTError(500, "Error querying database");
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

  try {
    return await sqlconnector.withConnection(async (connection) => {
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
    });
  } catch {
    throw new RESTError(500, "Error querying database");
  }
}

/**
 * Club person ids from the requested list. Ids that are missing or belong
 * to another club are omitted.
 *
 * @param {number[]} personIds
 * @returns {Promise<Set<number>>}
 */
async function findClubPersonIds(personIds) {
  if (!personIds.length) {
    return new Set();
  }

  const rows = await sqlconnector.withConnection(async (connection) => {
    return sqlconnector.runQuery(
      connection,
      `SELECT p.id
       FROM clubhouse.person p
       WHERE p.id IN ?
         AND p.club = ?`,
      [[personIds], CLUB_ID]
    );
  });

  return new Set(
    (Array.isArray(rows) ? rows : []).map((row) => Number(row.id))
  );
}

/**
 * Suggest participant types for the given people from today's member sessions.
 * Loads member-group bookings (activity_group = 1) on the club-local date that
 * include at least one requested club person. Club programs and support
 * blocks are ignored. Each row still has the full roster so player count and
 * duration are complete; only 1–4 player rosters contribute to the factor.
 *
 * Unknown ids (not a person at this club) still get a row with
 * player_type_id null. A known person with no member sessions today is a
 * non-repeater.
 *
 * @param {number[]} personIds
 * @returns {Promise<{ date: string, players: Array<{ person_id: number, player_type_id: number|null }> }>}
 */
async function suggestPlayerTypesForToday(personIds) {
  const OPCODE = "SUGGEST_PLAYER_TYPES";

  try {
    const [today, knownIds] = await Promise.all([
      clubcontroller.getClubLocalToday(),
      findClubPersonIds(personIds),
    ]);

    const sessions =
      knownIds.size === 0
        ? []
        : await getBookingsForDate(today, {
            personIds: [...knownIds],
            groupId: MEMBER_ACTIVITY_GROUP_ID,
          });
    const classified = suggestPlayerTypes(personIds, sessions, knownIds);

    return {
      date: today,
      players: classified.map(({ person_id, player_type_id }) => ({
        person_id,
        player_type_id,
      })),
    };
  } catch (error) {
    log(
      appLogLevels.ERROR,
      `Unable to suggest player types: ${error.message}`
    );
    throw error instanceof RESTError
      ? error
      : new SQLErrorFactory.getError(OPCODE, error);
  }
}

module.exports = {
  addBooking,
  getBookingData,
  processPatchCommand,
  getBookingsForDate,
  getOverlappingBookings,
  getCourtAvailability,
  buildBookingListFilters,
  suggestPlayerTypesForToday,
};
