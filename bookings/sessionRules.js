/**
 * Preferred duration and bumpable flag for a match-booking lineup.
 *
 * Counts: n = non-repeaters (1000), f = first repeaters (2000),
 * s = second repeaters (3000), total = n + f + s.
 *
 * Bumpable when any second repeater is on the roster (s > 0).
 *
 * Duration and eligibility come from the club's session_duration_policy
 * (see DEFAULT_SESSION_DURATION_POLICY for the default table).
 * Full allotment when n >= min_non_repeaters and s <= max_second_repeaters
 * for that player count; otherwise the reduced slot.
 */

const { PLAYER_TYPE_IDS, MEMBER_ACTIVITY_GROUP_ID } = require("./playerType");
const { DEFAULT_SESSION_DURATION_POLICY } = require("../club/sessionDurationPolicy");

const MATCH_PLAYER_TYPE_IDS = new Set([
  PLAYER_TYPE_IDS.NON_REPEATER,
  PLAYER_TYPE_IDS.FIRST_REPEATER,
  PLAYER_TYPE_IDS.SECOND_REPEATER,
]);

/**
 * @param {number} nonRepeaterCount
 * @param {number} secondRepeaterCount
 * @param {number} playerCount
 * @returns {boolean}
 */
function isFullAllotment(nonRepeaterCount, secondRepeaterCount, playerCount, policy = DEFAULT_SESSION_DURATION_POLICY) {
  const condition = policy[playerCount]?.full_allotment;
  return condition != null
    && nonRepeaterCount >= condition.min_non_repeaters
    && secondRepeaterCount <= condition.max_second_repeaters;
}

/**
 * @param {unknown[]} playerTypes
 * @returns {{
 *   player_types: number[],
 *   player_count: number,
 *   max_duration_min: number,
 *   bumpable: boolean
 * }}
 */
function resolveSessionRules(playerTypes, policy = DEFAULT_SESSION_DURATION_POLICY) {
  if (!Array.isArray(playerTypes) || playerTypes.length < 1 || playerTypes.length > 4) {
    throw new Error("Incorrect number of player types");
  }

  const ids = playerTypes.map(Number);
  if (ids.some((id) => !MATCH_PLAYER_TYPE_IDS.has(id))) {
    throw new Error("Unknown player type");
  }

  let nonRepeaters = 0;
  let secondRepeaters = 0;

  ids.forEach((id) => {
    if (id === PLAYER_TYPE_IDS.NON_REPEATER) {
      nonRepeaters += 1;
    } else if (id === PLAYER_TYPE_IDS.SECOND_REPEATER) {
      secondRepeaters += 1;
    }
  });

  const playerCount = ids.length;
  const table = policy[playerCount];
  const full = isFullAllotment(nonRepeaters, secondRepeaters, playerCount, policy);

  return {
    player_types: ids,
    player_count: playerCount,
    max_duration_min: full ? table.full_duration_min : table.reduced_duration_min,
    bumpable: secondRepeaters > 0,
  };
}

/** Validate member play at creation; club events use their own duration policy. */
function memberSessionRuleError(booking, policy = DEFAULT_SESSION_DURATION_POLICY) {
  if (Number(booking.group_id) !== MEMBER_ACTIVITY_GROUP_ID) {
    return null;
  }

  let rule;
  try {
    rule = resolveSessionRules(booking.players?.map((player) => player.player_type_id), policy);
  } catch {
    return "Invalid player type for a member booking";
  }

  const duration = (Number(booking.utc_end) - Number(booking.utc_start)) / 60;
  if (!Number.isFinite(duration) || duration < 5 || duration > 180) {
    return "Member sessions must be between 5 and 180 minutes long";
  }

  const overridesRule = duration > rule.max_duration_min
    || (rule.bumpable && Number(booking.bumpable) !== 1);
  if (overridesRule && !(typeof booking.notes === "string" && booking.notes.trim())) {
    return "Explain the session rule override in the note";
  }
  return null;
}

module.exports = {
  MATCH_PLAYER_TYPE_IDS,
  isFullAllotment,
  resolveSessionRules,
  memberSessionRuleError,
};
