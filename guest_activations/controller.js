const sqlconnector = require('../db/SqlConnector')
const club_id = process.env.CLUB_ID;
const SQLErrorFactory = require('./../utils/SqlErrorFactory');
const RESTError = require('./../utils/RESTError');

/**
 * 
 * @param {Number} member Id of member
 * @param {Number[]} guests Array of integer Ids for guests
 */
async function addGuestActivationsInBulk(member, guests) {

    //TO DO Move most queries to stored procedure for better performance

    const OPCODE = "ACTIVATE_GUESTS";

    if (!Array.isArray(guests)) {
        throw new RESTError(400, "Guest list error ")
    }

    const member_check_q = "SELECT club FROM active_members WHERE id = ? and club = ? LOCK IN SHARE MODE";
    const guests_check_q = "SELECT club FROM inactive_guests WHERE id in ? and club = ? LOCK IN SHARE MODE";
    const club_date_q = "SELECT CAST(convert_tz(now(),@@GLOBAL.time_zone,c.time_zone)  as DATE) as local_date from club c where c.id = ? LOCK IN SHARE MODE";

    const connection = await sqlconnector.getConnection()

    try {

        await sqlconnector.runQuery(connection, "START TRANSACTION", []);

        try {

            //Get club timezone
            const local_club_date_res = await sqlconnector.runQuery(connection, club_date_q, club_id);

            if (!Array.isArray(local_club_date_res) || local_club_date_res.length !== 1) {
                throw new RESTError(400, "Club configuration error")
            }

            const local_club_date = local_club_date_res[0].local_date;

            //Check if the member is active and belongs to club defined in .env
            const m_club_res = await sqlconnector.runQuery(connection, member_check_q, [member, club_id]);

            if (!Array.isArray(m_club_res) || m_club_res.length !== 1) {
                throw new RESTError(400, "Member error")
            }

            //Check inactive guests belonging to the club
            const g_clubs_res = await sqlconnector.runQuery(connection, guests_check_q, [[guests], club_id]);

            if (!Array.isArray(g_clubs_res) || g_clubs_res.length !== guests.length) {
                throw new RESTError(400, "Guest list error. Reload and try again");
            }

            let guest_activations = guests.map((guest_id) => {
                return [null, null, null, member, guest_id, local_club_date, false, 1];
            });

            const insert_q = "insert into guest_activation values ?"

            await sqlconnector.runQuery(connection, insert_q, [guest_activations]);

            await sqlconnector.runQuery(connection, "COMMIT", []);

            return true;

        }
        catch (error) {
            await sqlconnector.runQuery(connection, "ROLLBACK", [])
            throw error;
        }
    }
    catch (error) {
        throw error instanceof RESTError ? error : new SQLErrorFactory.getError(OPCODE, error)
    }
    finally {
        connection.release();
    }


}

/**
 * Return current activations for a given club
 */
async function getCurrentActivations() {

    const query = `
    select 
        a.id,
        a.created,
        MD5(a.updated) as etag,
        concat(pm.firstname,' ',pm.lastname) as member,
        member as member_id,
        concat(pg.firstname,' ',pg.lastname) as guest,
        guest as guest_id,
        a.active_date, 
        isfamily 
    from guest_activation a 
    join person pg on pg.id = a.guest
    join person pm on pm.id = a.member
    join club c on c.id = pm.club
    where
        a.status = 1 AND
        c.id = ? AND
        a.active_date = CAST( getClubTime(now(),c.time_zone) as DATE)
    `;

    const players_Query = `
        select person from player 
        where player.activity in 
            (SELECT 
                a.id FROM clubhouse.activity a 
                join court c on c.id = a.court 
                join club cl on cl.id = c.club 
                where a.date = CAST( getClubTime(now(),cl.time_zone) as DATE) 
                and a.active = 1
                and cl.id = ?
            )
        order by person;
    `

    const connection = await sqlconnector.getConnection()

    //Keep all the current players in a set for efficient lookup
    const players = new Set();

    try {

        const current_players_result = await sqlconnector.runQuery(connection, players_Query, [club_id])

        if( ! Array.isArray(current_players_result)){
            throw new Error("Unable to check current players");
        }

        //Load players into a set
        current_players_result.forEach((elem) => {
            players.add(elem.person);
        })

        const current_activations_result = await sqlconnector.runQuery(connection, query, [club_id])

        return current_activations_result.map((row) => 
            (
             { 
                id: row.id, 
                created: row.created, 
                etag: row.etag,
                member: row.member,
                guest: row.guest,
                member_id: row.member_id,
                guest_id: row.guest_id,
                active_date: row.active_date,
                isfamily: row.isfamily,
                has_played: players.has(row.guest_id) ? true : false
             }
            )
        );


    }
    catch (error) {
        console.log(error)
        throw error
    }
    finally {
        connection.release()
    }
}

/**
 * 
 * @param {object []} activation_records Array of activation_records update commands.
 * 
 * Update command format 
 * { 
 *  id: record.id,
 *  etag: record.etag,
 * }
 * 
 */
async function deactivateGuests(activation_records) {

    if (!Array.isArray(activation_records)) {
        throw new Error("Activation records must be an array");
    }

    const connection = await sqlconnector.getConnection();

    try {

        await sqlconnector.runQuery(connection, "START TRANSACTION", []);

        try {

            for (const record of activation_records) {
                await __deactivateGuest(connection, record.id, record.etag );
            }

            await sqlconnector.runQuery(connection, "COMMIT", [])

            return true;
        }
        catch (err) {

            await sqlconnector.runQuery(connection, "ROLLBACK", [])
            throw err;
        }

    }
    catch (error) {
        throw error
    }
    finally {
        connection.release();
    }



}

/**
 * 
 * @param {number} id guest_activtion id
 * @param {string} etag guest_activation etag
 * @returns 
 */
async function deactivateGuest( id, etag ){
    if( ! (id && etag)){
        throw new Error("ID or ETAG missing");
    }

    const connection = await sqlconnector.getConnection();

    try {

        await sqlconnector.runQuery(connection, "START TRANSACTION", []);

        try {

            
            await __deactivateGuest(connection, id, etag );
            
            await sqlconnector.runQuery(connection, "COMMIT", [])

            return true;
        }
        catch (err) {

            await sqlconnector.runQuery(connection, "ROLLBACK", [])
            throw err;
        }

    }
    catch (error) {
        throw error
    }
    finally {
        connection.release();
    }
}

/**
 * 
 * @param {Object } connection MySQL connection object 
 * @param { Number } id Guest Activation record ID
 * @param { String } etag Etag of the entity
 *  
 * IMPORTANT: Must be contained in a SQL transaction to work correctly.
 */
async function __deactivateGuest(connection, id, etag) {

    const gaQuery = `
        SELECT ga.id, 
            ga.active_date,
            ga.guest,
            unix_timestamp(convert_tz(active_date,c.time_zone,'UTC')) as start_utc_ts,
            unix_timestamp(now()) as now_utc_ts 
        FROM guest_activation ga 
            join person p on p.id = ga.member 
            join club c on c.id = p.club 
        WHERE ga.id = ? and MD5(updated) = ? and status = 1
        FOR UPDATE;
    `

    const guestPlayedQuery = `
        SELECT EXISTS( SELECT a.id FROM activity a JOIN player p ON p.activity = a.id WHERE p.person = ? AND a.date = ? AND a.active = 1 LOCK IN SHARE MODE) as guest_played;
    `

    const updateGaQuery = `
        UPDATE guest_activation SET status = 0 WHERE id = ?
    `

    const ga_result = await sqlconnector.runQuery(connection, gaQuery, [id, etag]);

    if (!(Array.isArray(ga_result) && ga_result.length === 1)) {
        throw new Error("Activation not found or modified.");
    }

    //UTC Values in seconds
    const activation_start = ga_result[0].start_utc_ts;

    //Add a day worth of seconds to compute activation end time
    const activation_end = activation_start + 86400;
    const current_time = ga_result[0].now_utc_ts;
    const guest_active_date = ga_result[0].active_date;
    const guest_id = ga_result[0].guest;

    //Do not allow past activations to be removed.
    //We may want to allow this in the future for admins so this check should not be done in the database
    if( activation_end <= current_time ){
        throw new Error("Past activations removal not allowed");
    }

    //Do not allow guests that have played to be removed
    const guestPlayed_result = await sqlconnector.runQuery(connection, guestPlayedQuery, [guest_id, guest_active_date]);

    if (!(Array.isArray(ga_result) && ga_result.length === 1)) {
        throw new Error("Unable to verify guest play time");
    }

    if( guestPlayed_result[0].guest_played === 1){
        throw new Error("Cannot deactivate a guest that has already played.");
    }

    await sqlconnector.runQuery(connection, updateGaQuery, [id]);

}

module.exports = {
    addGuestActivationsInBulk,
    getCurrentActivations,
    deactivateGuests,
    deactivateGuest
}