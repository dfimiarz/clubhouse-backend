# API security review — working list

Reviewed: Express app, routes, MySQL, REST auth/authz (2026-08-21).
Follow-up: generic 500s + frontend error unwrap (2026-08-22).
Follow-up: CORS fail-closed, global rate limit, Firebase identity (2026-08-22).
Follow-up: guest registration enumeration + captcha replay (2026-08-23).

Use this file as the source of truth. In a new session, point at one item:

> Work on item 1 in `docs/security-review.md`. Mark it done when finished.

Tick boxes here as items land. Do not re-audit the whole API unless the item says so.

Related repos:

- Backend: this repo (`clubhouse-backend`)
- Frontend: `../clubhouse-frontend-vue3` (Axios error unwrap already committed)

---

## Verdict

Prepared statements and club-scoping on writes are consistently used. Public calendar endpoints are thinner than authenticated ones. The remaining risk is **authorization** (who can do what), **PII over-exposure**, and **how kiosk geo-auth is granted**. Classic SQL injection is not the main problem.

## Already solid (do not redo)

- Parameterized SQL via `runExecute` / `runQuery`. Dynamic list filters only splice constant fragments plus `?` binds.
- Club isolation on writes (`CLUB_ID`).
- Public vs authenticated shapes (`public/controller.js` strips names/notes, today-only).
- Zod validation on many mutating routes; booking patch uses etag.
- Secrets stay out of the image (`.dockerignore`).
- Geo-auth from the public internet is rejected when the TCP peer is not private/loopback.

---

## Suggested order

Work top-down. Items 1 and 4 are small PII fixes. Item 2 is ops/nginx as much as code. Item 3 is the product/authz design.

| # | Status | Severity | Summary |
| --- | --- | --- | --- |
| 1 | [x] | High | Lock down `GET /persons` (`SELECT *`) |
| 2 | [ ] | High | Tighten kiosk `X-AUTH-CLIENT` / geo-auth |
| 3 | [ ] | High | Actor checks on booking and guest-pass writes |
| 4 | [x] | Medium | Stop returning emails from `GET /persons/active` |
| 5 | [x] | Medium | Generic 500 bodies; `RESTError` for expected failures |
| 6 | [x] | Medium | CORS fail-closed, global rate limit, verified Firebase email |
| 7 | [x] | Medium | Unauthenticated / broken routes (`/club`, `/booking_types`, `POST /bookings/batch`) |
| 8 | [x] | Medium | Guest registration enumeration + captcha replay |
| 9 | [ ] | Low | Hygiene (headers, body limit, id validation, PII logs, stub route) |

Frontend companion for item 5: [x] unwrap `{ errors }` in `processAxiosError` (`clubhouse-frontend-vue3`).

---

## Item 1 — `GET /persons` dumps the person table

**Status:** [x]

**Files:** `persons/api.js` (`GET /`), `persons/controller.js` `getPersons()`

```sql
SELECT * from person
```

Any Firebase user or kiosk session got every row and column: `email`, `phone`, `gender`, `note`, and **all clubs** (no `WHERE club = ?`).

Vue3 never called this route (roster search is `GET /persons/active`). `getEligiblePersons` in the frontend client is dead and pointed at `/persons/eligible`, which also does not exist.

**Fix (landed):** Removed `GET /persons` and `getPersons()`. Do not reintroduce a `SELECT *` person dump.

---

## Item 2 — Kiosk geo-auth equals full API access

**Status:** [ ]

**Files:** `middleware/clientauth.js` (`authGuard`, `getGeoAuthState`, `isTrustedProxySource`)

`authGuard` accepts Firebase **or** `geoauth`. `geoauth` is `X-AUTH-CLIENT: 1` plus a TCP peer in loopback / RFC1918 / ULA / link-local.

Typical deploy: Node only sees nginx at `127.0.0.1`, so every request is a “trusted source.” Then the header is enough for operator access. The comment says nginx’s geo module should *set* that header. If nginx forwards the client copy, the internet gets kiosk powers.

**Fix:**

- Nginx must **set** `X-AUTH-CLIENT` and **strip** any client copy. Confirm `nginx/templates/geoauth.conf` in the frontend deploy.
- Prefer a shared secret header over `"1"`.
- Optionally restrict geo-auth to schedule + booking routes, not persons / reports / guest passes.

---

## Item 3 — Authenticated writes have no actor checks

**Status:** [ ]

**Files:** `bookings/api.js`, `bookings/permissions/BookingValidator.js`, `guest_passes/api.js`, `persons/api.js` (`POST /guests`)

`res.locals.username` / `res.locals.role` are set globally but almost never used for authorization. `authGuard` only requires *some* principal.

| Action | Missing check |
| --- | --- |
| `POST /bookings` | Caller need not be on the roster, a host, or staff |
| `PATCH /bookings/:id` | Same; validator only checks time windows |
| `POST /guest_passes` | Any auth’d caller can issue a pass for **any** guest as **any** `guest_host` |
| `POST /persons/guests` | Captcha skipped when `geoauth` **or** `userauth` is true |

If Firebase is issued to ordinary members (role lookup is by `person.email`), a member can cancel anyone’s session, book for others, and mint guest passes. Kiosk geo-auth is meant to be privileged; remote member logins should not inherit that.

**Fix:** Split kiosk/staff vs member. Members: create/cancel/move only own bookings (or require `MANAGER`/`ADMIN`). Bind `POST /guest_passes` to the logged-in person as host, or require staff.

This is a product decision. Confirm intended roles before coding.

---

## Item 4 — `GET /persons/active` returns emails and role internals

**Status:** [x]

**Files:** `persons/controller.js` `fetchActivePersonsFromDB()`, `GET /persons/active` in `persons/api.js`

`SELECT m.* FROM membership_view` included `email`, `role`, `role_name`, `valid_from`, `valid_until`. Cached in Redis and returned to every authenticated client.

Vue3 never reads `email` (or `role` / `role_name` / membership dates) from this payload. `searchActivePersons` / `usePersonSearch` feed the booking picker and pass-host search; they use `id`, `firstname`, `lastname`, `public_label`, `requires_pass`, `pass`. Host filtering is `?host=1` (`guest_host` on the server).

**Fix (landed):** Project `id, firstname, lastname, public_label, guest_host, requires_pass, pass`. Map the same allow-list on the way out so a stale Redis entry cannot leak email for the remaining TTL.

---

## Item 5 — Generic 500 bodies; `RESTError` for expected failures

**Status:** [x] backend `0861c38`; frontend `1f352d4` in `clubhouse-frontend-vue3`

Unexpected failures return `{ errors: "Something went wrong" }`. Only `RESTError` sets status + payload. Invalid token is 401; patch command validation is 422.

Frontend `processAxiosError` unwraps `{ errors }` to a string for toasts; `{ fielderrors }` is unchanged for forms.

**Client-visible contract (keep when touching errors):**

- Unexpected 500: `{ errors: "Something went wrong" }` (was a JSON string of `err.message`)
- Invalid Firebase token: **401** `"Unable to verify auth token"` (was 500)
- Patch command validation: **422** string (was 500 in production)

Do not revert the shared `utils/errorHandler.js`. Route tests should `app.use(errorHandler)`, not a copy that echoes `err.message`.

---

## Item 6 — CORS, rate limits, Firebase identity

**Status:** [x]

**Files:** `utils/corsOrigins.js`, `server.js`, `rate-limiter/rate-limiter.js`, `middleware/clientauth.js`

### CORS

Fallback `/localhost:5173$/` was unanchored at the start (`https://evil-localhost:5173` matched). Combined with `credentials: true` if `CORS_ORIGINS` was unset on a browser-reachable host.

**Fix (landed):** `getAllowedOrigins()` lives in `utils/corsOrigins.js`.

- Production with empty `CORS_ORIGINS` returns `[]` (deny all browser origins). Same-origin nginx `/api` does not need CORS.
- `CORS_ORIGINS` entries are canonicalized to exact `http(s)` origins (path stripped, invalid entries dropped).
- Dev fallback is anchored: `localhost` / `127.0.0.1` / `[::1]:5173` and `*.clubhouse.test:8081`.

### Rate limits

`apilimiter` was exported and never mounted. Limits existed only on captcha, guest registration, public reads, and analytics.

**Fix (landed):** `apilimiter` is mounted in `server.js` after `checkGeoAuth` and before Firebase `checkUserAuth`. A stricter `writelimiter` covers `POST /bookings`, `PATCH /bookings/:id`, and `POST /guest_passes`. Health (`/`, `/alive`) and CORS preflight are skipped. Kiosk `geoauth` gets a higher cap (calendar polling from one LAN IP).

`req.ip` follows `X-Forwarded-For` only when `TRUST_PROXY_MODE` is not `false`. Geo-auth still uses `socket.remoteAddress`. Nginx must **overwrite** `X-Forwarded-For` if you trust the proxy; otherwise every client shares the proxy IP and one bucket.

### Firebase

- `email_verified` was not checked
- Authorization scheme was not required to be `Bearer` (`Token <jwt>` was accepted)
- Identity was email, not uid
- `userauth === true` even when `role === null` (no membership)

**Fix (landed):** `parseBearerToken` requires `Bearer`. `checkUserAuth` stores `uid` + email, requires a non-disabled Firebase user, and sets `emailVerified` from the live user record. `checkUserRole` looks up membership only for verified emails and sets `userauth` only when `role != null` (guest `500` counts). Invalid/disabled tokens are still 401 on every route. Unverified or non-member tokens do **not** 401 public routes or `GET /auth/user/profile` (`role: null`); they fail `authGuard`.

Membership is still keyed by verified email (`person.email`). There is no `firebase_uid` column; uid is on `res.locals` only.

Vue3 already sends `Authorization: Bearer <idToken>`. Unverified Firebase accounts will boot public mode (profile `role` null) until the email is verified.

---

## Item 7 — Routes without `authGuard` / dead batch insert

**Status:** [x]

`GET /club` stays public. Vue3 calls it on every boot (including anonymous) for branding, About, timezone, and calendar hours. Do not put `authGuard` on it.

**Fix (landed):**

| Route | Auth now | Notes |
| --- | --- | --- |
| `GET /club` | none + public-read limiter | Public DTO: branding, hours, about, public settings, `{id, public_label}` roles. Strips role capabilities (`event_host`, `guest_host`, `requires_pass`, internal `label` / type ids), `guest_req_limit`, and unknown keys. Same allow-list on the way out so a stale Redis entry cannot leak. Frontend boot still requires a non-empty `roles` array. |
| `GET /booking_types` | `authGuard` | Catalog flags (`restricted`, `member_rebookable`) are operator/member-only. Vue3 already loaded this only after auth. |
| `GET /auth/geo`, `GET /auth/user/profile` | none | Keep: kiosk vs anonymous boot probes. They echo the caller's own `geoauth` / `role` only. Locking profile would set kiosk `geoauth` to false (no Firebase user, 401, public fallback). |
| `GET /auth/captcha` | **removed** | Unused SVG captcha (`svg-captcha` + in-process unused `verifyCaptcha`). |
| `POST /persons/guests` | captcha if anonymous | Intended; see item 8. |
| `POST /bookings/batch` | **removed** | Called `addBookingBatch`, which did not exist. Route, validator, and `utils/JSONvalidator.js` deleted. |
| `/public/*` | none + limiter | OK (today-only, no names). |
| `/reports/*` | `roleGuard` only | OK: missing role → 401. |

---

## Item 8 — Guest registration: enumeration and captcha

**Status:** [x]

**Files:** `persons/api.js` `POST /guests`, `persons/controller.js` `addGuest`, `auth/controller.js` `verifyhCaptcha`

- `409` `"Guest already exists"` on email enumerates member/guest emails.
- hCaptcha replay map is in-process (lost on restart, not shared across instances). Prefer Redis (already used for SVG captcha).
- `HCAPTCHA_ALLOWED_HOSTNAMES=","` → empty list → hostname check skipped.
- SVG `GET /auth/captcha` is unused; `verifyCaptcha` never deletes the Redis key (reusable for 60s if anything starts calling it).

**Fix (landed):**

- Anonymous `POST /persons/guests` no longer discloses duplicates. Email or name+phone matches, and a `(club, email)` unique-key race (`errno` 1062), return the same **201** as a create and do not insert. Authenticated / kiosk callers still get **409** `{ fielderrors }` on `email` or `phone` so operators can find the existing person.
- hCaptcha used tokens are `SET NX EX 120` in Redis (`hcaptcha:used:<sha256>`), claimed **before** `siteverify` so two instances cannot both pass. Redis errors fail closed (captcha rejected, no skip).
- Empty hostname allow-list never skips the check. Production with unset/`","` rejects every hostname. Dev unset/`","` falls back to `localhost` and `clubhouse.test`.
- Removed unused `GET /auth/captcha`, `svg-captcha`, and `uuid`. Vue3 uses hCaptcha only.

---

## Item 9 — REST / ops hygiene

**Status:** [ ] (pick off independently; none is a blocker for 1–4)

- No security headers (`Helmet` or nginx: `X-Content-Type-Options`, `Referrer-Policy`).
- No explicit JSON body size on `express.json()` / `bodyParser.json()` (Express default 100kb).
- `GET`/`PATCH /bookings/:id` do not validate `id` as a positive integer (binds are still parameterized).
- `roleGuard` returns 401 instead of 403 for an authenticated caller with the wrong role.
- No pagination on list endpoints.
- PII in INFO logs: full booking objects; guest `{email, phone, name}` (`bookings/controller.js`, `persons/controller.js`).
- Redis has no TLS (`db/RedisConnector.js`).
- `GET /club_schedule/current` returns the literal `"current_schedule"` (`club_schedule/api.js`).
- Mixed JSON parsers: some routers `express.json()`, courts/schedule still `body-parser`.
- `GET /bookings/overlapping` does not join on club (`bookings/controller.js`). Court ids are global PKs; still filter `c.club = ?`.

---

## MySQL notes (reference only)

Injection risk is low. Keep `multipleStatements` off. Do not interpolate user-controlled object keys into SQL (`namedPlaceholders` is on). `IN ?` with nested arrays must stay on `runQuery`, not `runExecute`.
