/**
 * Preferred duration and bumpable flag for a match-booking lineup.
 *
 * Counts: n = non-repeaters (1000), f = first repeaters (2000),
 * s = second repeaters (3000), total = n + f + s.
 *
 * Bumpable when any second repeater is on the roster (s > 0).
 *
 * Duration is a 4-row lookup by player count. "Full allotment" is the
 * longer slot; everything else uses the reduced slot.
 *
 *   players | full | reduced
 *   1       | 45   | 45
 *   2       | 60   | 30
 *   3       | 60   | 30
 *   4       | 90   | 45
 *
 * Full allotment when:
 *   1 player, or
 *   2 players and both non-repeaters, or
 *   3 players, at least two non-repeaters, and no second-repeaters, or
 *   4 players and all non-repeaters.
 */

const { PLAYER_TYPE_IDS } = require("./playerType");

const MATCH_PLAYER_TYPE_IDS = new Set([
  PLAYER_TYPE_IDS.NON_REPEATER,
  PLAYER_TYPE_IDS.FIRST_REPEATER,
  PLAYER_TYPE_IDS.SECOND_REPEATER,
]);

const DURATION_BY_COUNT = {
  1: { full: 45, reduced: 45 },
  2: { full: 60, reduced: 30 },
  3: { full: 60, reduced: 30 },
  4: { full: 90, reduced: 45 },
};

/**
 * @param {number} nonRepeaterCount
 * @param {number} secondRepeaterCount
 * @param {number} playerCount
 * @returns {boolean}
 */
function isFullAllotment(nonRepeaterCount, secondRepeaterCount, playerCount) {
  switch (playerCount) {
    case 1:
      return true;
    case 2:
      return nonRepeaterCount === 2;
    case 3:
      return nonRepeaterCount >= 2 && secondRepeaterCount === 0;
    case 4:
      return nonRepeaterCount === 4;
    default:
      return false;
  }
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
function resolveSessionRules(playerTypes) {
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
  const table = DURATION_BY_COUNT[playerCount];
  const full = isFullAllotment(nonRepeaters, secondRepeaters, playerCount);

  return {
    player_types: ids,
    player_count: playerCount,
    max_duration_min: full ? table.full : table.reduced,
    bumpable: secondRepeaters > 0,
  };
}

module.exports = {
  MATCH_PLAYER_TYPE_IDS,
  isFullAllotment,
  resolveSessionRules,
};
