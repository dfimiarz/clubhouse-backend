const sqlconnector = require('../db/SqlConnector')
const club_id = process.env.CLUB_ID;

/**
 * 
 * @param { Request } request 
 */
async function getBookingTypes(request) {

    const query = `SELECT * from activity_type`;

    return sqlconnector.withConnection(async (connection) => {
        return sqlconnector.runExecute(connection, query);
    });

}

module.exports = {
    getBookingTypes
}
