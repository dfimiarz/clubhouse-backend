const sqlconnector = require("../db/SqlConnector");
const club_id = process.env.CLUB_ID;
const SQLErrorFactory = require("./../utils/SqlErrorFactory");
const RESTError = require("./../utils/RESTError");

/**
 *
 * @param {Number} member Id of member
 * @param {Number[]} guests Array of integer Ids for guests
 */
async function addGuestActivationsInBulk(member, guests) {
  const OPCODE = "ACTIVATE_GUESTS";

  if (!Array.isArray(guests)) {
    throw new RESTError(400, "Guest list error ");
  }

  //Query to check if member is active
  const member_check_q =
    "SELECT EXISTS (SELECT 1 FROM active_members WHERE id = ? and club = ? LOCK IN SHARE MODE) as 'member_found'";

  //Query to check if guests are valid
  const guests_check_q =
    "SELECT COUNT(*) as 'guest_count' FROM person WHERE id IN ? AND club = ? AND type = 2 LOCK IN SHARE MODE";

  //Query to get all active guests for a date
  const guests_activation_check_q =
    "SELECT EXISTS (SELECT guest FROM guest_activation WHERE status = 1 AND active_date = ? AND guest IN ? FOR UPDATE) as 'guest_active'";

  //Query to get local date
  const club_date_q =
    "SELECT CAST(convert_tz(now(),@@GLOBAL.time_zone,c.time_zone)  as DATE) as local_date from club c where c.id = ? LOCK IN SHARE MODE";

  try {
    return await sqlconnector.withTransaction(async (connection) => {
      //Get club date (scalar bind — prepared statement)
      const local_club_date_res = await sqlconnector.runExecute(
        connection,
        club_date_q,
        [club_id]
      );

      if (
        !Array.isArray(local_club_date_res) ||
        local_club_date_res.length !== 1
      ) {
        throw new RESTError(400, "Club configuration error");
      }

      const local_club_date = local_club_date_res[0].local_date;

      //Check if a member is active and belongs to club defined in .env
      const m_result = await sqlconnector.runExecute(connection, member_check_q, [
        member,
        club_id,
      ]);

      if (!Array.isArray(m_result) || m_result[0].member_found !== 1) {
        throw new RESTError(400, "Member error");
      }

      //Check if guests belong to the club (IN ? needs query expansion)
      const g_result = await sqlconnector.runQuery(connection, guests_check_q, [
        [guests],
        club_id,
      ]);

      if (
        !Array.isArray(g_result) ||
        g_result[0].guest_count !== guests.length
      ) {
        throw new RESTError(400, "Guest list error. Reload and try again");
      }

      //Check if guests are activated (IN ? needs query expansion)
      const activations_result = await sqlconnector.runQuery(
        connection,
        guests_activation_check_q,
        [local_club_date, [guests]]
      );

      if (!Array.isArray(activations_result)) {
        throw new RESTError(400, "Error checking guest activations");
      }

      if (activations_result[0].guest_active !== 0) {
        throw new RESTError(400, "A guest is already active");
      }

      const guest_activations = guests.map((guest_id) => {
        return [member, guest_id, local_club_date, false, 1];
      });

      const insert_q =
        "INSERT INTO guest_activation (member, guest, active_date, isfamily, status) VALUES ?";

      await sqlconnector.runQuery(connection, insert_q, [guest_activations]);

      return true;
    });
  } catch (error) {
    throw error instanceof RESTError
      ? error
      : new SQLErrorFactory.getError(OPCODE, error);
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
        pm.firstname as host_firstname,
        pm.lastname as host_lastname,
        member as member_id,
        pg.firstname as guest_firstname,
        pg.lastname as guest_lastname,
        guest as guest_id,
        a.active_date, 
        isfamily,
        TIME_FORMAT(getClubTime(a.created,c.time_zone),"%r") as time_activated
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
        select person from participant
        where participant.activity in 
            (SELECT 
                a.id FROM clubhouse.activity a 
                join court c on c.id = a.court 
                join club cl on cl.id = c.club 
                where a.date = CAST( getClubTime(now(),cl.time_zone) as DATE) 
                and a.active = 1
                and cl.id = ?
            )
        order by person;
    `;

  return sqlconnector.withConnection(async (connection) => {
    //Keep all the current players in a set for efficient lookup
    const players = new Set();

    const current_players_result = await sqlconnector.runExecute(
      connection,
      players_Query,
      [club_id]
    );

    if (!Array.isArray(current_players_result)) {
      throw new Error("Unable to check current players");
    }

    //Load players into a set
    current_players_result.forEach((elem) => {
      players.add(elem.person);
    });

    const current_activations_result = await sqlconnector.runExecute(
      connection,
      query,
      [club_id]
    );

    return current_activations_result.map((row) => ({
      id: row.id,
      created: row.created,
      etag: row.etag,
      guest_firstname: row.guest_firstname,
      guest_lastname: row.guest_lastname,
      host_firstname: row.host_firstname,
      host_lastname: row.host_lastname,
      member_id: row.member_id,
      guest_id: row.guest_id,
      active_date: row.active_date,
      isfamily: row.isfamily,
      has_played: players.has(row.guest_id) ? true : false,
      time_activated: row.time_activated,
    }));
  });
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

  return sqlconnector.withTransaction(async (connection) => {
    for (const record of activation_records) {
      await __deactivateGuest(connection, record.id, record.etag);
    }

    return true;
  });
}

/**
 *
 * @param {number} id guest_activtion id
 * @param {string} etag guest_activation etag
 * @returns
 */
async function deactivateGuest(id, etag) {
  if (!(id && etag)) {
    throw new Error("ID or ETAG missing");
  }

  return sqlconnector.withTransaction(async (connection) => {
    await __deactivateGuest(connection, id, etag);
    return true;
  });
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
    `;

  const guestPlayedQuery = `
        SELECT EXISTS( SELECT a.id FROM activity a JOIN participant p ON p.activity = a.id WHERE p.person = ? AND a.date = ? AND a.active = 1 LOCK IN SHARE MODE) as guest_played;
    `;

  const updateGaQuery = `
        UPDATE guest_activation SET status = 0 WHERE id = ?
    `;

  const ga_result = await sqlconnector.runExecute(connection, gaQuery, [
    id,
    etag,
  ]);

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
  if (activation_end <= current_time) {
    throw new Error("Past activations removal not allowed");
  }

  //Do not allow guests that have played to be removed
  const guestPlayed_result = await sqlconnector.runExecute(
    connection,
    guestPlayedQuery,
    [guest_id, guest_active_date]
  );

  if (!(Array.isArray(guestPlayed_result) && guestPlayed_result.length === 1)) {
    throw new Error("Unable to verify guest play time");
  }

  if (guestPlayed_result[0].guest_played === 1) {
    throw new Error("Guest has already played.");
  }

  await sqlconnector.runExecute(connection, updateGaQuery, [id]);
}

module.exports = {
  addGuestActivationsInBulk,
  getCurrentActivations,
  deactivateGuests,
  deactivateGuest,
};
