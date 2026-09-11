const sql = require("../db/SqlConnector");
const RESTError = require("../utils/RESTError");
const { ROLE_TYPES } = require("../utils/dbconstants");
const { personIdsFromPlayers } = require("./playerOverlap");
const { loadRoleSettings } = require("../club/restrictedMemberSettings");
const { evaluatePlayAfter, evaluateAllowedDays } = require("../guest-pass-types/rules");
const { WEEKDAY_NAMES, bookingWeekday } = require("../guest-pass-types/weekdays");

const CLUB_ID = process.env.CLUB_ID;

// Use membership on the session date, never the client-supplied participant type.
async function assertRestrictedMembersCanPlay(connection, booking) {
  const ids = personIdsFromPlayers(booking?.players);
  if (!ids.length) return;
  const members = await sql.runQuery(connection,
    `SELECT p.id, p.firstname, p.lastname, r.id AS role_id, r.lbl AS role_label
     FROM person p
     JOIN membership m ON m.person_id = p.id AND ? >= m.valid_from AND ? < m.valid_until
     JOIN role r ON r.id = m.role
     WHERE p.id IN ? AND p.club = ? AND r.type = ?
     ORDER BY r.id, p.id
     LOCK IN SHARE MODE`,
    [booking.date, booking.date, [ids], CLUB_ID, ROLE_TYPES.RESTRICTED_MEMBER_TYPE]);
  if (!Array.isArray(members)) throw new Error("Unable to check restricted memberships");
  const settingsByRole = await loadRoleSettings(connection, members.map(member => member.role_id), { lock: true });
  const messages = new Set();
  for (const member of members) {
    const settings = settingsByRole.get(Number(member.role_id));
    const name = [member.firstname, member.lastname].filter(Boolean).join(" ") || "A member";
    const role = member.role_label || "Restricted member";
    if (!evaluateAllowedDays(settings.allowed_days, booking).ok) {
      const day = WEEKDAY_NAMES[bookingWeekday(booking.date) - 1] || "this day";
      messages.add(`${name}'s ${role} membership does not allow play on ${day}.`);
    } else {
      const time = evaluatePlayAfter(settings.play_after, booking);
      if (!time.ok) messages.add(`${name}'s ${role} membership does not allow play before ${time.clock}.`);
    }
  }
  if (messages.size) throw new RESTError(422, [...messages].join(" "));
}

module.exports = { assertRestrictedMembersCanPlay };
