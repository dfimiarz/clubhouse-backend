const sqlconnector = require("../db/SqlConnector");
const redisconnector = require("../db/RedisConnector");
const club_id = process.env.CLUB_ID;
const ACTIVE_PERSONS_CACHE_KEY = `active_persons_${club_id}`;
const ACTIVE_PERSONS_CACHE_TTL_SECONDS = 60;
const SQLErrorFactory = require("./../utils/SqlErrorFactory");
const RESTError = require("./../utils/RESTError");
const { log, appLogLevels } = require('./../utils/logger/logger');
const { normalizeWhitespace, normalizeEmail, normalizePhone } = require("../utils/utils");
const {
  loadSettingsByPassType,
  rulesForPassType,
} = require("../guest-pass-types/settings");

const SEARCH_RESULT_LIMIT = 20;

/**
 * Lowercase and strip diacritics so name matching is accent-insensitive,
 * mirroring the utf8mb4_0900_ai_ci collation used by the database.
 */
function foldAccents(value) {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Fetch the full, unfiltered list of active persons for the club from the
 * database, with active guest-pass info already merged onto each guest.
 *
 * @returns {Promise<Array>} Full active-persons list
 */
async function fetchActivePersonsFromDB() {
  const member_query = `SELECT m.* FROM membership_view m
                  JOIN club c on c.id = m.club
                  WHERE DATE(convert_tz(NOW(),@@GLOBAL.time_zone,c.time_zone)) >= m.valid_from
                  AND DATE(convert_tz(NOW(),@@GLOBAL.time_zone,c.time_zone)) < m.valid_until
                  and m.club = ?`;

  const passes_query = `SELECT gp.id,guest_id,gp.type,gpt.label FROM clubhouse.guest_pass gp
    join person p on p.id = gp.guest_id
    join club c on p.club = c.id
    join guest_pass_type gpt on gpt.id = gp.type
    WHERE
    c.id = ? AND
    gp.valid = 1 AND
    convert_tz(NOW(),@@GLOBAL.time_zone,c.time_zone) BETWEEN gp.valid_from and gp.valid_to`;

  return sqlconnector.withConnection(async (connection) => {
    const active_passes = await sqlconnector.runExecute(
      connection,
      passes_query,
      [club_id]
    );

    const settingsByType = await loadSettingsByPassType(
      connection,
      active_passes.map((pass) => pass.type)
    );

    //Create a hash map with key being guest_id and values being pass_id, type, and label
    const active_passes_hash = active_passes.reduce((acc, val) => {
      acc[val.guest_id] = {
        id: val.id,
        type: val.type,
        label: val.label,
        ...rulesForPassType(settingsByType, val.type),
      };
      return acc;
    }, {});

    const persons = await sqlconnector.runExecute(connection, member_query, [
      club_id,
    ]);

    //Loop through persons and add active pass info to each guest
    persons.forEach((person) => {
      if (
        person.requires_pass === 1 &&
        active_passes_hash[person.id]
      ) {
        person.pass = active_passes_hash[person.id];
      }
    });

    return persons;
  });
}

/**
 * Returns a list of persons active membership. This includes guests with active status.
 *
 * Reads the full active list from a Redis cache (cache-aside) and applies the
 * filters in Node. On a cache miss or Redis error, falls back to the database.
 *
 * @param {Object} [filters]
 * @param {number[]} [filters.ids] Return exactly these persons (takes precedence over search)
 * @param {string} [filters.search] Case-insensitive name search, results limited to 20
 * @param {boolean} [filters.host] Restrict to guest hosts (guest_host = 1)
 */
async function getActivePersons({ ids, search, host } = {}) {
  let persons = null;
  
  //Try the cache first
  try {
    persons = await redisconnector.getJSON(ACTIVE_PERSONS_CACHE_KEY);
  } catch (error) {
    log(appLogLevels.ERROR, `Error retrieving active persons from cache: ${error}`);
  }

  //Cache miss (or Redis error): fall back to the DB and repopulate the cache
  if (!persons) {
    persons = await fetchActivePersonsFromDB();

    try {
      await redisconnector.storeJSON(
        ACTIVE_PERSONS_CACHE_KEY,
        persons,
        ACTIVE_PERSONS_CACHE_TTL_SECONDS
      );
    } catch (error) {
      log(appLogLevels.ERROR, `Error storing active persons to cache: ${error}`);
    }
  }

  let results = persons;

  if (host) {
    results = results.filter((person) => person.guest_host === 1);
  }

  if (Array.isArray(ids) && ids.length > 0) {
    const idSet = new Set(ids.map(Number));
    results = results.filter((person) => idSet.has(Number(person.id)));
  } else if (search) {
    const term = foldAccents(search);
    results = results
      .filter((person) => {
        const firstname = foldAccents(person.firstname);
        const lastname = foldAccents(person.lastname);
        const fullname = `${firstname} ${lastname}`;
        return (
          firstname.includes(term) ||
          lastname.includes(term) ||
          fullname.includes(term)
        );
      })
      .sort((a, b) => {
        const lastCmp = (a.lastname || "").localeCompare(b.lastname || "");
        return lastCmp !== 0
          ? lastCmp
          : (a.firstname || "").localeCompare(b.firstname || "");
      })
      .slice(0, SEARCH_RESULT_LIMIT);
  }

  return results;
}

async function getClubManagers() {
  const query = `select p.id,p.firstname,p.lastname from person p join member m on m.person_id = p.id join club c on p.club = c.id 
    where 
    role > 2000 and 
    curtime() >= getDbTime(m.valid_from,c.time_zone) and
    curtime() < getDbTime(m.valid_until,c.time_zone) and club = ? order by role,lastname
    `;
  return sqlconnector.withConnection(async (connection) => {
    return sqlconnector.runExecute(connection, query, [club_id]);
  });
}

async function getEventHosts() {
  const query = `SELECT m.id, m.firstname, m.lastname 
                FROM membership_view m JOIN club c ON c.id = m.club 
                WHERE event_host = 1 
                AND DATE(convert_tz(NOW(),@@GLOBAL.time_zone,c.time_zone)) >= m.valid_from 
                AND DATE(convert_tz(NOW(),@@GLOBAL.time_zone,c.time_zone)) < m.valid_until
                AND club = ?`;
  return sqlconnector.withConnection(async (connection) => {
    return sqlconnector.runExecute(connection, query, [club_id]);
  });
}

async function addGuest(request) {
  const OPCODE = "ADD_GUEST";

  const firstname = normalizeWhitespace(request.body.firstname);
  const lastname = normalizeWhitespace(request.body.lastname);
  const email = normalizeEmail(request.body.email);
  const phone = normalizePhone(request.body.phone);
  const GUEST_ROLE_ID = 500;

  const _firstNames = firstname.split(" ");
  const _lastNames = lastname.split("-");

  const formattedFirstName = _firstNames.reduce((acc, val, index) => {
    return (
      acc +
      (index === 0 ? "" : " ") +
      val.charAt(0).toUpperCase() +
      val.slice(1).toLowerCase()
    );
  }, "");

  const formattedLastName = _lastNames.reduce((acc, val, index) => {
    return (
      acc +
      (index === 0 ? "" : "-") +
      val.charAt(0).toUpperCase() +
      val.slice(1).toLowerCase()
    );
  }, "");

  const person_query =
    "INSERT INTO `person` (`club`,`created`,`firstname`,`lastname`,`email`,`phone`,`gender`) VALUES (?,now(),?,?,?,?,DEFAULT)";
  const membership_query =
    "INSERT INTO `membership` (`person_id`,`valid_from`,`valid_until`,`role`) VALUES (?,CURDATE(),DATE_ADD(DATE_FORMAT(NOW(), '%Y-01-01'), INTERVAL 1 YEAR),?)";

  try {
    await sqlconnector.withTransaction(async (connection) => {
      const duplicateGuest = await findDuplicateGuest(connection, {
        firstname: formattedFirstName,
        lastname: formattedLastName,
        email,
        phone,
      });

      if (duplicateGuest) {
        throw buildDuplicateGuestError(duplicateGuest);
      }

      const person_insert_result = await sqlconnector.runExecute(
        connection,
        person_query,
        [club_id, formattedFirstName, formattedLastName, email, phone]
      );

      const person_id = person_insert_result.insertId;

      await sqlconnector.runExecute(connection, membership_query, [
        person_id,
        GUEST_ROLE_ID,
      ]);
    }, { mode: "readWrite" });

    //Invalidate the active-persons cache so the new guest shows up immediately.
    //Best effort: the cache TTL bounds staleness if the delete fails.
    try {
      await redisconnector.deleteKey(ACTIVE_PERSONS_CACHE_KEY);
    } catch (error) {
      log(appLogLevels.WARNING, `Error invalidating active persons cache: ${error}`);
    }

    log(appLogLevels.INFO, `Guest added: ${JSON.stringify({ firstname: formattedFirstName, lastname: formattedLastName, email: email, phone: phone })}`);
  } catch (error) {
    if (error instanceof RESTError) {
      throw error;
    }

    throw new SQLErrorFactory.getError(OPCODE, error);
  }
}

async function findDuplicateGuest(connection, guest) {
  const emailQuery = `
    SELECT id
    FROM person
    WHERE club = ?
      AND LOWER(TRIM(email)) = ?
    LIMIT 1
  `;
  const emailMatches = await sqlconnector.runQuery(connection, emailQuery, [
    club_id,
    normalizeEmail(guest.email),
  ]);

  if (Array.isArray(emailMatches) && emailMatches.length > 0) {
    return { kind: "email", id: emailMatches[0].id };
  }

  if (!guest.phone) {
    return null;
  }

  const identityQuery = `
    SELECT id
    FROM person
    WHERE club = ?
      AND LOWER(TRIM(firstname)) = ?
      AND LOWER(TRIM(lastname)) = ?
      AND TRIM(phone) = ?
    LIMIT 1
  `;
  const identityMatches = await sqlconnector.runQuery(connection, identityQuery, [
    club_id,
    guest.firstname.toLowerCase(),
    guest.lastname.toLowerCase(),
    normalizePhone(guest.phone),
  ]);

  if (Array.isArray(identityMatches) && identityMatches.length > 0) {
    return { kind: "identity", id: identityMatches[0].id };
  }

  return null;
}

function buildDuplicateGuestError(duplicateGuest) {
  if (duplicateGuest.kind === "email") {
    return new RESTError(409, {
      fielderrors: [{ param: "email", msg: "Guest already exists" }],
    });
  }

  return new RESTError(409, {
    fielderrors: [{ param: "phone", msg: "Guest already exists" }],
  });
}

async function getPersons() {
  const query = `SELECT * from person`;
  return sqlconnector.withConnection(async (connection) => {
    return sqlconnector.runExecute(connection, query);
  });
}

module.exports = {
  addGuest: addGuest,
  findDuplicateGuest,
  getPersons,
  getActivePersons,
  getClubManagers,
  getEventHosts
};
