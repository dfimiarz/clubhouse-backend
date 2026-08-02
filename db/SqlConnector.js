const mysql = require("mysql2/promise");

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
  queueLimit: 0,
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
 * @param {import("mysql2/promise").PoolConnection} connection
 * @param {string} query
 * @param {Array|object|*} [values=[]]
 */
async function runExecute(connection, query, values = []) {
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
  const connection = await getConnection();
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

  return withConnection(async (connection) => {
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
      } catch {
        // Prefer the original error from the transaction body.
      }
      throw error;
    }
  });
}

module.exports = {
  getPool,
  getConnection,
  runQuery,
  runExecute,
  withConnection,
  withTransaction,
};
