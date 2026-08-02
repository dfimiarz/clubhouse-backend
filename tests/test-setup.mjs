import "dotenv/config";

// test-setup.js
import { createPool } from "mysql2/promise";

const pool_config = {
  connectionLimit: 10,
  host: process.env.SQL_HOST || "localhost",
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  port: process.env.SQL_PORT || 3306,
  connectTimeout: 10000,
  waitForConnections: true,
  queueLimit: 0,
  timezone: "Z",
  dateStrings: true,
  namedPlaceholders: true,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10_000,
};

const pool = createPool(pool_config);

/**
 * @returns {Promise<import("mysql2/promise").PoolConnection>}
 */
function getConnection() {
  return pool.getConnection();
}

// Function to set up the database
async function setupDatabase() {
  const createDatabaseQuery = `CREATE DATABASE IF NOT EXISTS clubhouse_test DEFAULT CHARACTER SET utf8mb4`;

  const connection = await getConnection();
  try {
    await connection.query(createDatabaseQuery);
  } finally {
    connection.release();
  }
}

// Function to tear down the database
async function teardownDatabase() {
  const dropDatabaseQuery = "DROP DATABASE IF EXISTS clubhouse_test";

  const connection = await getConnection();
  try {
    await connection.query(dropDatabaseQuery);
  } finally {
    connection.release();
  }
}

// Export the setup and teardown functions
export { setupDatabase, teardownDatabase, getConnection };
