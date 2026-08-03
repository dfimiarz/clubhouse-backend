const sqlconnector = require('../db/SqlConnector');

const CLUB_ID = process.env.CLUB_ID;

/**
 * Courts for this club, each with supported_activity_types from activity_supported.
 * @param { Request } request
 */
async function getCourts(request) {
  const courts_query = `SELECT id, club, name
                        FROM court
                        WHERE club = ?
                        ORDER BY id`;

  const support_query = `SELECT s.court, s.activity_type
                         FROM activity_supported s
                         JOIN court c ON c.id = s.court
                         WHERE c.club = ?`;

  return sqlconnector.withConnection(async (connection) => {
    const courts = await sqlconnector.runExecute(connection, courts_query, [
      CLUB_ID,
    ]);
    const support_rows = await sqlconnector.runExecute(
      connection,
      support_query,
      [CLUB_ID]
    );

    const supported_by_court = new Map();
    if (Array.isArray(support_rows)) {
      for (const row of support_rows) {
        if (!supported_by_court.has(row.court)) {
          supported_by_court.set(row.court, []);
        }
        supported_by_court.get(row.court).push(row.activity_type);
      }
    }

    if (!Array.isArray(courts)) {
      return courts;
    }

    return courts.map((court) => ({
      id: court.id,
      club: court.club,
      name: court.name,
      supported_activity_types: supported_by_court.get(court.id) ?? [],
    }));
  });
}

module.exports = {
  getCourts: getCourts,
};
