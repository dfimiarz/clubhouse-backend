const sqlconnector = require("../db/SqlConnector");
const { MATCH_PLAYER_TYPE_IDS } = require("../bookings/sessionRules");

/**
 * Match-booking participant types (non-repeater / first / second).
 * Event host (4000) is omitted — that type is event-booking only.
 */
async function getParticipantTypes() {
  const query = `SELECT id, \`desc\` AS label, lbl
                 FROM participant_type
                 WHERE id IN (?, ?, ?)
                 ORDER BY id`;

  return sqlconnector.withConnection(async (connection) => {
    const rows = await sqlconnector.runExecute(
      connection,
      query,
      Array.from(MATCH_PLAYER_TYPE_IDS)
    );
    return (Array.isArray(rows) ? rows : []).map((row) => ({
      id: Number(row.id),
      label: row.label,
      lbl: row.lbl,
    }));
  });
}

module.exports = {
  getParticipantTypes,
};
