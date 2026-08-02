const mysql = require("mysql2/promise");
const { log, appLogLevels } = require("../utils/logger/logger");

// Configuration for the connection pool. See mysql2 docs for details.
const config = {
  connectionLimit: 10,
  host: process.env.SQL_HOST || "localhost",
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  database: process.env.SQL_DATABASE,
  port: process.env.SQL_PORT || 3306,
  connectTimeout: 10000,
  waitForConnections: true,
  // Bounded so sustained pool exhaustion sheds load immediately instead of
  // accumulating waiters that each burn ACQUIRE_TIMEOUT_MS before failing.
  queueLimit: 50,
  timezone: "Z",
  dateStrings: true,
  // Allows :name binds alongside classic ? placeholders (query + execute).
  namedPlaceholders: true,
  // Helps idle pooled connections survive middleboxes / Cloud SQL proxies.
  enableKeepAlive: true,
  keepAliveInitialDelay: 10_000,
};

// If NODE_ENV === 'production' and a Unix socket name is defined, use CLOUD_SQL_CONNECTION_NAME.
// Needed to connect to Google Cloud SQL from App Engine.
if (
  process.env.CLOUD_SQL_CONNECTION_NAME &&
  process.env.NODE_ENV === "production"
) {
  config.socketPath = `/cloudsql/${process.env.CLOUD_SQL_CONNECTION_NAME}`;
}

// mysql2's pool has no acquire timeout of its own: once connectionLimit is
// reached, getConnection() queues the caller indefinitely. The mysql driver
// used to fail after acquireTimeout, so keep that fail-fast behaviour here.
const ACQUIRE_TIMEOUT_MS = Number(process.env.SQL_ACQUIRE_TIMEOUT_MS || 10000);

const pool = mysql.createPool(config);

/**
 * @returns {import("mysql2/promise").Pool}
 */
function getPool() {
  return pool;
}

/**
 * Borrow a connection from the pool, failing after ACQUIRE_TIMEOUT_MS rather
 * than waiting forever on an exhausted pool.
 *
 * @returns {Promise<import("mysql2/promise").PoolConnection>}
 */
async function getConnection() {
  const acquire = pool.getConnection();
  let timer;

  try {
    return await Promise.race([
      acquire,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error(
            `Timeout acquiring database connection after ${ACQUIRE_TIMEOUT_MS}ms`
          );
          error.code = "POOL_ACQUIRE_TIMEOUT";
          reject(error);
        }, ACQUIRE_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    // The acquire may still succeed after we gave up — hand that connection
    // back to the pool instead of leaking it.
    acquire.then((connection) => connection.release()).catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run a text-protocol query (supports nested-array expansion for IN ? / VALUES ?,
 * toSqlString objects, and named placeholders).
 *
 * Preserves the historical contract: returns rows / ResultSetHeader only (not [rows, fields]).
 *
 * @param {import("mysql2/promise").PoolConnection} connection
 * @param {string} query
 * @param {Array|object|*} [values=[]]
 */
async function runQuery(connection, query, values = []) {
  const [results] = await connection.query(query, values);
  return results;
}

/**
 * Run a binary prepared statement. Prefer for stable SQL with scalar binds only.
 * Do not use for IN ? / VALUES ? bulk expansion or toSqlString values — use runQuery.
 *
 * execute() goes through a server-side prepared statement, which has no
 * client-side nested-array expansion: an array bind is sent as a single scalar
 * and silently matches nothing rather than erroring. Reject it up front so the
 * mistake surfaces here instead of as an empty result set downstream.
 *
 * @param {import("mysql2/promise").PoolConnection} connection
 * @param {string} query
 * @param {Array|object|*} [values=[]]
 */
async function runExecute(connection, query, values = []) {
  // namedPlaceholders is on, so values may legitimately be a plain object.
  const binds = Array.isArray(values)
    ? values
    : values && typeof values === "object"
      ? Object.values(values)
      : [];

  if (binds.some(Array.isArray)) {
    throw new TypeError(
      "runExecute cannot expand array binds (IN ? / VALUES ?) — use runQuery"
    );
  }

  const [results] = await connection.execute(query, values);
  return results;
}

/**
 * Borrow a connection, run work, always release.
 *
 * @template T
 * @param {(connection: import("mysql2/promise").PoolConnection) => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withConnection(fn) {
  // Calls the helper through `api` rather than the module-scope binding, so a
  // test that replaces sqlconnector.getConnection actually intercepts it.
  // A bare getConnection() here resolves lexically and ignores the export.
  const connection = await api.getConnection();
  try {
    return await fn(connection);
  } finally {
    connection.release();
  }
}

/**
 * @typedef {"default" | "readOnly" | "readWrite"} TransactionMode
 */

/**
 * Borrow a connection, run work inside a transaction, commit or roll back, always release.
 *
 * @template T
 * @param {(connection: import("mysql2/promise").PoolConnection) => Promise<T>} fn
 * @param {{ mode?: TransactionMode }} [options]
 * @returns {Promise<T>}
 */
async function withTransaction(fn, options = {}) {
  const mode = options.mode || "default";

  // Via `api` for the same reason as in withConnection.
  return api.withConnection(async (connection) => {
    if (mode === "readOnly") {
      await connection.query("START TRANSACTION READ ONLY");
    } else if (mode === "readWrite") {
      await connection.query("START TRANSACTION READ WRITE");
    } else {
      await connection.beginTransaction();
    }

    try {
      const result = await fn(connection);
      await connection.commit();
      return result;
    } catch (error) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        // Still prefer the original error from the transaction body, but a
        // failed rollback is worth knowing about on its own.
        log(
          appLogLevels.WARNING,
          `Transaction rollback failed: ${rollbackError.message}`
        );
      }
      throw error;
    }
  });
}

/**
 * Single object shared by the module's own internals and its consumers.
 *
 * module.exports = { getConnection } would copy the function reference into a
 * property, leaving the module-scope binding untouched — so replacing
 * sqlconnector.getConnection in a test would not affect callers inside this
 * file. Holding one object and calling through it (api.getConnection()) keeps
 * the two in sync, which is what makes withConnection/withTransaction
 * stubbable.
 */
const api = {
  getPool,
  getConnection,
  runQuery,
  runExecute,
  withConnection,
  withTransaction,
};

module.exports = api;
