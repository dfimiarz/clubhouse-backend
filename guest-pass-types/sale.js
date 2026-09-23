const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
const sqlconnector = require("../db/SqlConnector");
const { constraintsFromSettings } = require("./settings");
const { hasPlayableTime, timeToMinutes } = require("./rules");
const { loadOpenHours, openFramesOn } = require("../club_schedule/hours");
const { MIN_SESSION_DURATION_MIN } = require("../bookings/sessionRules");

dayjs.extend(utc);
dayjs.extend(timezone);

const DATETIME = "YYYY-MM-DD HH:mm:ss";

// Reasons shared by POST /guest_passes (400 message) and the catalog.
const NO_SEASON_REASON = "Guest passes are not sold outside the season.";
const INVALID_CONFIG_REASON = "Invalid pass configuration.";
const NOT_STARTED_REASON = "Pass is not available.";

const CLUB_SEASON_Q = `
    select
      c.id,
      c.name,
      c.time_zone,
      cs.id as season_id,
      cs.name as season_name,
      cs.start as season_start,
      cs.end as season_end
    from club c join club_seasons cs on cs.club = c.id
    WHERE
      c.id = ?
      AND DATE(convert_tz(NOW(),@@session.time_zone,c.time_zone)) >= cs.start
      AND DATE(convert_tz(NOW(),@@session.time_zone,c.time_zone)) < cs.end`;

/**
 * @typedef {object} SaleContext
 * @property {object} season Club time zone and the season row in progress
 * @property {import("dayjs").Dayjs} now Club-local time of the sale
 * @property {import("dayjs").Dayjs} seasonStart Club-local start of the first season day
 * @property {import("dayjs").Dayjs} seasonLastSecond Club-local last second before the (exclusive) season end
 * @property {import("../club_schedule/hours").OpenHoursRow[]} openHours Open hours from today to season end
 */

/**
 * Everything a sale decision needs that does not depend on the pass type,
 * or null when no season is in progress.
 *
 * @param {*} connection
 * @param {unknown} clubId
 * @param {{ lock?: boolean }} [options] Lock the rows read, inside a sale transaction.
 * @returns {Promise<SaleContext|null>}
 */
async function loadSaleContext(connection, clubId, { lock = false } = {}) {
    const rows = await sqlconnector.runExecute(
        connection,
        lock ? `${CLUB_SEASON_Q}\n    FOR SHARE` : CLUB_SEASON_Q,
        [clubId]
    );
    if (!(Array.isArray(rows) && rows.length === 1)) return null;

    const season = rows[0];
    const { time_zone } = season;
    // Season dates are club-local DATE strings (dateStrings pool option).
    const seasonStart = dayjs.tz(season.season_start, time_zone);
    const seasonLastSecond = dayjs.tz(season.season_end, time_zone).subtract(1, "second");
    const now = dayjs().tz(time_zone);
    const openHours = await loadOpenHours(
        connection,
        clubId,
        now.format("YYYY-MM-DD"),
        seasonLastSecond.format("YYYY-MM-DD"),
        { lock }
    );

    return { season, now, seasonStart, seasonLastSecond, openHours };
}

/**
 * Validity of a pass sold now: from the start of today through
 * valid_days - 1 more days, cut off at the season's last second.
 *
 * @param {SaleContext} context
 * @param {number} valid_days
 * @returns {{ valid_from: import("dayjs").Dayjs, from: string, to: string }}
 */
function passWindow(context, valid_days) {
    const valid_from = context.now.startOf("day");
    const valid_to = valid_from.add(valid_days - 1, "day").endOf("day");
    const end = valid_to.isAfter(context.seasonLastSecond) ? context.seasonLastSecond : valid_to;
    return { valid_from, from: valid_from.format(DATETIME), to: end.format(DATETIME) };
}

/**
 * Whether a pass type can be sold now. `reason` is null when a guest could
 * still start a session with it before it expires, otherwise the message
 * POST /guest_passes refuses with.
 *
 * @param {SaleContext} context
 * @param {{ label: string, valid_days: number }} passType
 * @param {object} settings Resolved pass type settings
 * @returns {{ window: ReturnType<typeof passWindow>|null, reason: string|null }}
 */
function evaluateSale(context, { label, valid_days }, settings) {
    if (!(valid_days >= 1)) return { window: null, reason: INVALID_CONFIG_REASON };

    const window = passWindow(context, valid_days);
    if (window.valid_from.isBefore(context.seasonStart)) {
        return { window, reason: NOT_STARTED_REASON };
    }

    const { now, openHours } = context;
    const playable = hasPlayableTime(settings, {
        from: window.from.slice(0, 10),
        to: window.to.slice(0, 10),
        nowMin: now.hour() * 60 + now.minute(),
        lastStartMin: timeToMinutes(window.to.slice(11)),
        minSessionMin: MIN_SESSION_DURATION_MIN,
        openFrames: (date) => openFramesOn(openHours, date),
    });
    if (playable) return { window, reason: null };

    const rules = constraintsFromSettings(settings).map((constraint) => `${constraint.text}.`);
    const detail = rules.length > 0 ? rules.join(" ") : "No open court time is left.";
    return { window, reason: `${label} cannot be used before it expires. ${detail}` };
}

module.exports = { NO_SEASON_REASON, loadSaleContext, evaluateSale };
