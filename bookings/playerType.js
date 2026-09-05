/**
 * Suggest a participant type from how many distinct member sessions
 * the person has today.
 *
 *   0 sessions → Non-repeater (1000)
 *   1 session  → First Repeater (2000)
 *   2+         → Second Repeater (3000)
 *
 * Court/time moves share origin_activity_id and count as one session.
 * Club and support activities do not count.
 */

const PLAYER_TYPE_IDS = {
  NON_REPEATER: 1000,
  FIRST_REPEATER: 2000,
  SECOND_REPEATER: 3000,
};

// activity_group.id for member play (Match, Ball Machine). Same bucket
// reports use for member court time.
const MEMBER_ACTIVITY_GROUP_ID = 1;

/**
 * @param {unknown} value
 * @returns {number|null}
 */
function toPersonId(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {unknown} value
 * @returns {number|null}
 */
function toPositiveInt(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * Map a session count to a participant type id, or null when n is not
 * a finite non-negative number.
 *
 * @param {unknown} n
 * @returns {number|null}
 */
function playerTypeFromSessionCount(n) {
  if (n == null || n === "") {
    return null;
  }
  const count = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(count) || count < 0) {
    return null;
  }
  if (count < 1) {
    return PLAYER_TYPE_IDS.NON_REPEATER;
  }
  if (count < 2) {
    return PLAYER_TYPE_IDS.FIRST_REPEATER;
  }
  return PLAYER_TYPE_IDS.SECOND_REPEATER;
}

/**
 * Logical session id for one booking row. Prefers origin_activity_id;
 * falls back to the row id when origin was never written.
 *
 * @param {{ id?: unknown, origin_activity_id?: unknown }} booking
 * @returns {number|null}
 */
function originIdFromBooking(booking) {
  const origin = toPositiveInt(booking?.origin_activity_id);
  if (origin != null) {
    return origin;
  }
  return toPositiveInt(booking?.id);
}

/**
 * Distinct origin ids for this person's member-group bookings today.
 * Only activity_group 1 (member) counts.
 *
 * @param {number|string} personId
 * @param {Array<{ id?: unknown, origin_activity_id?: unknown, group_id?: number, players?: Array }>} bookings
 * @returns {number[]}
 */
function playerSessionOriginsFromBookings(personId, bookings) {
  const id = toPersonId(personId);
  if (id == null || !Array.isArray(bookings)) {
    return [];
  }

  const origins = new Set();

  bookings.forEach((booking) => {
    if (Number(booking?.group_id) !== MEMBER_ACTIVITY_GROUP_ID) {
      return;
    }

    const players = Array.isArray(booking?.players) ? booking.players : [];
    const onRoster = players.some(
      (player) => toPersonId(player?.person_id) === id
    );
    if (!onRoster) {
      return;
    }

    const origin = originIdFromBooking(booking);
    if (origin == null) {
      return;
    }
    origins.add(origin);
  });

  return [...origins];
}

/**
 * @param {number[]} personIds
 * @param {Array} bookings Today's member-group bookings that include at least one of these people
 * @param {Set<number>} knownIds Club person ids. Anyone else gets player_type_id null.
 * @returns {Array<{ person_id: number, session_count: number|null, player_type_id: number|null, origins: number[] }>}
 */
function suggestPlayerTypes(personIds, bookings, knownIds) {
  return personIds.map((personId) => {
    if (!knownIds.has(personId)) {
      return {
        person_id: personId,
        session_count: null,
        player_type_id: null,
        origins: [],
      };
    }

    const origins = playerSessionOriginsFromBookings(personId, bookings);
    return {
      person_id: personId,
      session_count: origins.length,
      player_type_id: playerTypeFromSessionCount(origins.length),
      origins,
    };
  });
}

module.exports = {
  PLAYER_TYPE_IDS,
  MEMBER_ACTIVITY_GROUP_ID,
  playerTypeFromSessionCount,
  originIdFromBooking,
  playerSessionOriginsFromBookings,
  suggestPlayerTypes,
};
