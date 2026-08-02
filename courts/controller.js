const sqlconnector = require('../db/SqlConnector');

const CLUB_ID = process.env.CLUB_ID;

/**
 * 
 * @param { Request } request 
 */
async function getCourts( request ){

    const query = `SELECT * FROM court WHERE club = ?`;

    return sqlconnector.withConnection(async (connection) => {
        return sqlconnector.runExecute(connection, query, [CLUB_ID]);
    });
    
}

module.exports = {
    getCourts: getCourts
};
