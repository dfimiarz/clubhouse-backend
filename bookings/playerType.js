/**
 * Suggest a participant type from a repeater factor f.
 *
 * Bands:
 *   f < 1      → Non-repeater (1000)
 *   1 <= f < 1.5 → First Repeater (2000)
 *   f >= 1.5   → Second Repeater (3000)
 *
 * computeRepeaterFactor sums, for each of that person's member-group
 * sessions today:
 *   durationMin / (45 * r(playerCount))
 * where
 *   r(x) = (-x^3 + 7x^2 - 12x + 12) / 6
 *   and x is the roster size, defined only for 1–4 players.
 *
 * Club and support activities, and rosters outside 1–4, do not count.
 */

const PLAYER_TYPE_IDS = {
  NON_REPEATER: 1000,
  FIRST_REPEATER: 2000,
  SECOND_REPEATER: 3000,
};

const FIRST_REPEATER_MIN = 1;
const SECOND_REPEATER_MIN = 1.5;
const SESSION_DURATION_UNIT_MIN = 45;
// activity_group.id for member play (Match, Ball Machine). Same bucket
// reports use for member court time.
const MEMBER_ACTIVITY_GROUP_ID = 1;
const MATCH_ROSTER_MIN = 1;
const MATCH_ROSTER_MAX = 4;

/**
 * @param {unknown} value
 * @returns {number|null}
 */
function toPersonId(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Map a factor to a participant type id, or null when f is not a finite number.
 *
 * @param {unknown} f
 * @returns {number|null}
 */
function playerTypeFromFactor(f) {
  if (f == null || f === "") {
    return null;
  }
  const n = typeof f === "number" ? f : Number(f);
  if (!Number.isFinite(n)) {
    return null;
  }
  if (n < FIRST_REPEATER_MIN) {
    return PLAYER_TYPE_IDS.NON_REPEATER;
  }
  if (n < SECOND_REPEATER_MIN) {
    return PLAYER_TYPE_IDS.FIRST_REPEATER;
  }
  return PLAYER_TYPE_IDS.SECOND_REPEATER;
}

/**
 * Duration in minutes and roster size for one booking the person played today.
 *
 * @typedef {object} PlayerSession
 * @property {number} durationMin end_min - start_min
 * @property {number} playerCount participants on that booking
 */

/**
 * Pull this person's member-group sessions out of today's bookings.
 * Only activity_group 1 (member) with a 1–4 player roster counts;
 * duration and player count come from the activity itself
 * (start_min/end_min and players.length).
 *
 * @param {number|string} personId
 * @param {Array<{ start_min?: number, end_min?: number, group_id?: number, players?: Array }>} bookings
 * @returns {PlayerSession[]}
 */
function playerSessionsFromBookings(personId, bookings) {
  const id = toPersonId(personId);
  if (id == null || !Array.isArray(bookings)) {
    return [];
  }

  return bookings.reduce((sessions, booking) => {
    if (Number(booking?.group_id) !== MEMBER_ACTIVITY_GROUP_ID) {
      return sessions;
    }

    const players = Array.isArray(booking?.players) ? booking.players : [];
    if (
      players.length < MATCH_ROSTER_MIN ||
      players.length > MATCH_ROSTER_MAX
    ) {
      return sessions;
    }

    const onRoster = players.some(
      (player) => toPersonId(player?.person_id) === id
    );
    if (!onRoster) {
      return sessions;
    }

    const startMin = Number(booking.start_min);
    const endMin = Number(booking.end_min);
    const durationMin = endMin - startMin;
    if (!Number.isFinite(durationMin) || durationMin <= 0) {
      return sessions;
    }

    sessions.push({
      durationMin,
      playerCount: players.length,
    });
    return sessions;
  }, []);
}

/**
 * Weight for one match roster size. Defined only for 1–4 players:
 * r(x) = (-x^3 + 7x^2 - 12x + 12) / 6
 *
 * @param {number} playerCount
 * @returns {number|null}
 */
function playerCountWeight(playerCount) {
  const x = playerCount;
  if (
    !Number.isInteger(x) ||
    x < MATCH_ROSTER_MIN ||
    x > MATCH_ROSTER_MAX
  ) {
    return null;
  }
  return (-x * x * x + 7 * x * x - 12 * x + 12) / 6;
}

/**
 * Contribution of one session to the day's repeater factor.
 *
 * @param {PlayerSession} session
 * @returns {number|null}
 */
function sessionRepeaterValue(session) {
  const durationMin = Number(session?.durationMin);
  const playerCount = Number(session?.playerCount);
  if (!Number.isFinite(durationMin) || durationMin <= 0) {
    return null;
  }
  const weight = playerCountWeight(playerCount);
  if (weight == null || weight <= 0) {
    return null;
  }
  const denominator = SESSION_DURATION_UNIT_MIN * weight;
  if (!Number.isFinite(denominator) || denominator === 0) {
    return null;
  }
  return durationMin / denominator;
}

/**
 * Sum of sessionRepeaterValue over the person's sessions today.
 * No sessions → 0 (non-repeater).
 *
 * @param {PlayerSession[]} playerSessions
 * @returns {number}
 */
function computeRepeaterFactor(playerSessions) {
  if (!Array.isArray(playerSessions)) {
    return 0;
  }

  return playerSessions.reduce((sum, session) => {
    const value = sessionRepeaterValue(session);
    return value == null ? sum : sum + value;
  }, 0);
}

/**
 * @param {number[]} personIds
 * @param {Array} bookings Today's member-group bookings that include at least one of these people
 * @param {Set<number>} knownIds Club person ids. Anyone else gets player_type_id null.
 * @returns {Array<{ person_id: number, factor: number|null, player_type_id: number|null, sessions: Array }>}
 */
function suggestPlayerTypes(personIds, bookings, knownIds) {
  return personIds.map((personId) => {
    if (!knownIds.has(personId)) {
      return {
        person_id: personId,
        factor: null,
        player_type_id: null,
        sessions: [],
      };
    }

    const rawSessions = playerSessionsFromBookings(personId, bookings);
    const factor = computeRepeaterFactor(rawSessions);
    const sessions = rawSessions.map((session) => ({
      durationMin: session.durationMin,
      playerCount: session.playerCount,
      value: sessionRepeaterValue(session),
    }));
    return {
      person_id: personId,
      factor,
      player_type_id: playerTypeFromFactor(factor),
      sessions,
    };
  });
}

module.exports = {
  PLAYER_TYPE_IDS,
  MEMBER_ACTIVITY_GROUP_ID,
  FIRST_REPEATER_MIN,
  SECOND_REPEATER_MIN,
  playerTypeFromFactor,
  playerSessionsFromBookings,
  sessionRepeaterValue,
  computeRepeaterFactor,
  suggestPlayerTypes,
};
