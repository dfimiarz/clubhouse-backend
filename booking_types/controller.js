const sqlconnector = require('../db/SqlConnector')
const club_id = process.env.CLUB_ID;

/**
 * Activity types enabled for this club (via activity_club).
 * @param { Request } request 
 */
async function getBookingTypes(request) {

    // Effective min_participant: club override if set, else global activity_type default
    const query = `SELECT
                     at.id,
                     at.\`group\`,
                     at.lbl,
                     at.\`desc\`,
                     at.restricted,
                     COALESCE(ac.min_participant, at.min_participant) AS min_participant,
                     at.calendar_style,
                     at.member_rebookable,
                     at.same_day_only
                   FROM activity_type at
                   JOIN activity_club ac ON ac.activity_type_id = at.id
                   WHERE ac.club_id = ?
                   ORDER BY at.id`;

    return sqlconnector.withConnection(async (connection) => {
        return sqlconnector.runExecute(connection, query, [club_id]);
    });

}

module.exports = {
    getBookingTypes
}
