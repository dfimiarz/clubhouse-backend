const Redis = require("ioredis");
const { log, appLogLevels } = require('./../utils/logger/logger');

const client = new Redis({
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT || 6379,
  username: "default",
  password: process.env.REDIS_PASSWORD,
  db: 0,
  //Fail fast when Redis is unavailable so callers can fall back to the DB
  //instead of stalling behind reconnect retries
  maxRetriesPerRequest: 1,
  commandTimeout: 500,
});

client.on("error", (err) => {
  log(appLogLevels.WARNING, `Redis client error: ${err}`);
});

/**
 * Get a JSON value from redis.
 *
 * Throws on Redis/parse errors; callers decide how to handle failures.
 *
 * @param {string} key
 * @returns {Promise<Object|null>} Parsed value, or null if the key is missing
 */
async function getJSON(key) {
  const redisData = await client.get(key);
  return redisData === null ? null : JSON.parse(redisData);
}

/**
 * Store a JSON value in redis.
 *
 * Throws on Redis errors; callers decide how to handle failures.
 *
 * @param {String} key Key to set
 * @param {Object} data Data to set
 * @param {number} [ttlSeconds] Optional expiry in seconds
 */
async function storeJSON(key, data, ttlSeconds) {
  const payload = JSON.stringify(data);
  if (ttlSeconds) {
    await client.set(key, payload, "EX", ttlSeconds);
  } else {
    await client.set(key, payload);
  }
}

/**
 * Delete a key from redis.
 *
 * Throws on Redis errors; callers decide how to handle failures.
 *
 * @param {String} key Key to delete
 */
async function deleteKey(key) {
  await client.del(key);
}

/**
 *
 * @returns Redis client object
 */
function getClient() {
  return client;
}

module.exports = {
  getClient,
  storeJSON,
  getJSON,
  deleteKey,
};
