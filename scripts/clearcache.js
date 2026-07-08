/**
 * Clear cached application data from Redis.
 *
 * Usage:
 *   node scripts/clearcache.js          Delete known app cache keys
 *   node scripts/clearcache.js --all    Flush the entire Redis db
 */
require("dotenv").config();

const { getClient } = require("./../db/RedisConnector");

//Key patterns written by the controllers (club, club_schedule, persons)
const CACHE_KEY_PATTERNS = [
  "club_info_*",
  "club_schedules_*",
  "active_persons_*",
];

async function main() {
  const client = getClient();
  const flushAll = process.argv.includes("--all");

  if (flushAll) {
    await client.flushdb();
    console.log("Flushed entire Redis db");
    return;
  }

  let deleted = 0;
  for (const pattern of CACHE_KEY_PATTERNS) {
    //SCAN instead of KEYS to avoid blocking the server on large keyspaces
    let cursor = "0";
    do {
      const [nextCursor, keys] = await client.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        100
      );
      cursor = nextCursor;
      if (keys.length > 0) {
        deleted += await client.del(...keys);
        console.log(`Deleted: ${keys.join(", ")}`);
      }
    } while (cursor !== "0");
  }

  console.log(
    deleted === 0
      ? "No cache keys found. Cache is already empty."
      : `Cleared ${deleted} cache key(s)`
  );
}

main()
  .catch((err) => {
    console.error(`Failed to clear cache: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => {
    getClient().quit();
  });
