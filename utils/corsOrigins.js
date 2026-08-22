"use strict";

const { log, appLogLevels } = require("./logger/logger");

/**
 * Local Vite and named vhost origins. Anchored so
 * `https://evil-localhost:5173` cannot piggy-back on a trailing `localhost:5173`.
 */
const DEV_ORIGIN_PATTERNS = [
  /^https?:\/\/localhost:5173$/,
  /^https?:\/\/127\.0\.0\.1:5173$/,
  /^https?:\/\/\[::1\]:5173$/,
  /^https?:\/\/([a-z0-9-]+\.)*clubhouse\.test:8081$/,
];

function isProduction(env) {
  return (env.NODE_ENV || "").trim().toLowerCase() === "production";
}

/**
 * Browser `Origin` is scheme + host + port, no path. Drop anything else
 * rather than treating it as a substring match.
 *
 * @param {string} entry
 * @returns {string|null}
 */
function canonicalizeOrigin(entry) {
  try {
    const url = new URL(entry);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function originsFromEnv(value) {
  const origins = [];

  for (const entry of (value || "").split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }

    const origin = canonicalizeOrigin(trimmed);
    if (!origin) {
      log(appLogLevels.WARNING, `Ignoring invalid CORS origin: ${trimmed}`);
      continue;
    }

    if (!origins.includes(origin)) {
      origins.push(origin);
    }
  }

  return origins;
}

/**
 * CORS allowlist.
 *
 * Production (same-origin nginx /api proxy): set CORS_ORIGINS to the public
 * site origin(s), e.g. "https://knicktennis.net,https://www.knicktennis.net".
 * Empty CORS_ORIGINS in production denies all browser origins (same-origin
 * traffic does not need CORS). Dev falls back to the anchored local patterns.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Array<string|RegExp>}
 */
function getAllowedOrigins(env = process.env) {
  const fromEnv = originsFromEnv(env.CORS_ORIGINS);

  if (fromEnv.length > 0) {
    return fromEnv;
  }

  if (isProduction(env)) {
    log(
      appLogLevels.ERROR,
      "CORS_ORIGINS is empty in production; denying all browser origins"
    );
    return [];
  }

  return DEV_ORIGIN_PATTERNS;
}

module.exports = {
  getAllowedOrigins,
  canonicalizeOrigin,
  DEV_ORIGIN_PATTERNS,
};
