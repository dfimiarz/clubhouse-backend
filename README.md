# clubhouse-backend

## Club settings

Per-club feature switches live in two places:

- **`club/settings.js`** — the registry. Declares every known key with its
  type, default and whether it is `public` (public settings are included in the
  unauthenticated `GET /club` payload). Defaults live here, next to the code
  that consumes them.
- **`club_setting`** (table) — overrides only, as `(club, setting_key,
  setting_value)` strings. A club with no row for a key gets the registry
  default, and rows for keys that are not in the registry are ignored.

Adding a setting costs one registry entry and no migration.

### Changing a setting for a club

```sql
INSERT INTO club_setting (club, setting_key, setting_value)
VALUES (1, 'rebooking_prompt_enabled', '1')
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value);
```

To put a club back on the default, delete its row rather than writing the
default value — an absent row cannot drift if the registry default changes.

Then **`yarn cache:clear`**. The `/club` payload is cached in Redis under
`club_info_<CLUB_ID>` with no TTL and nothing invalidates it at runtime, so a
DB change alone has no visible effect. This is the usual reason a flag "does
not work".

Booleans accept `'1'`/`'true'` and `'0'`/`'false'` (case-insensitive, trimmed).
A value the declared type cannot read falls back to the default rather than
erroring — so a typo such as `'yes'` silently leaves the setting at its default
instead of failing loudly. Check the stored value first when a flag appears not
to take effect.

### Current settings

| Key | Type | Default | Effect |
| --- | --- | --- | --- |
| `rebooking_prompt_enabled` | boolean | `false` | Show the back-to-back rebooking prompt in the match booking flow. Opt-in: set to `'1'` per club. Does **not** gate Fast rebook on Booking Details |
| `prevent_concurrent_member_bookings` | boolean | `true` | Reject a member activity (`activity_group = 1`) when any roster player already has an overlapping member session on another court. Club sessions are not checked. Seeded to `'1'` for existing clubs by migration `0012`. Opt out per club with `'0'` |
| `require_guests_accompanied_by_member` | boolean | `true` | Reject a guest-only roster (including a solo guest). Any non-guest member, instructor, or manager is enough. Seeded to `'1'` for existing clubs by migration `0013`. Opt out per club with `'0'` |

There is no write endpoint or admin UI yet — values are changed with SQL.

## Guest pass type settings

Per-type booking rules live in the same two-layer shape as club settings:

- **`guest-pass-types/settings.js`** — the registry. Declares every known key
  with its type and default. Defaults live here, next to the evaluator in
  `guest-pass-types/rules.js`.
- **`guest_pass_type_setting`** (table) — overrides only, as `(pass_type,
  setting_key, setting_value)` strings. A type with no row for a key gets the
  registry default (unrestricted), and rows for keys that are not in the
  registry are ignored.

Adding a rule costs one registry entry, one evaluator, and no migration.

`GET /guest-pass-types`, `GET /persons/active` (`person.pass`), and
`POST /guest_passes` all return the resolved `settings` object and a
`constraints` array of `{ key, text }` for every non-default rule. The
roster card shows a Restricted chip plus those texts; the buy dialog
lists the sentences under the selected type. Create and move still evaluate
the rules against the live table, not the Redis active-persons cache
(60s TTL).

### Changing a setting for a pass type

```sql
INSERT INTO guest_pass_type_setting (pass_type, setting_key, setting_value)
VALUES (2, 'play_after', '12:00')
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value);
```

To put a type back on the default, delete its row.

Times accept `HH:mm` or `HH:mm:ss` and are stored/compared as `HH:mm`. A value
the declared type cannot read falls back to the default (`null` = no
restriction). Booking create/move walks every registered rule on each
date-covering pass and accepts the guest when **any** of those passes satisfies
**all** of its rules. `play_after` compares the club-local session **start**
only, inclusive.

### Current settings

| Key | Type | Default | Effect |
| --- | --- | --- | --- |
| `play_after` | time | `null` | Guest may start a session at or after this club-local time. Opt in per pass type with `'HH:mm'` |

There is no write endpoint or admin UI yet — values are changed with SQL.

## Product analytics

Feature usage is recorded as events in the `app_event` table and read back
through the normal reports API. The shape mirrors club settings: the table
holds rows, the code holds the schema.

- **`analytics/eventTypes.js`** — the registry. Declares every event name and a
  strict `zod` schema for its `props`. An event name or a prop the registry
  does not know is a `400`, so a typo in a call site fails in development
  instead of becoming data nobody can query.
- **`app_event`** (table) — `club`, `name`, `created`, `actor`, `flow_id`,
  optional `client_ts` (ms since epoch from the client at enqueue), and a
  `props` JSON column. Everything specific to an event lives in `props`,
  including the `person_ids` it involves.

Adding an event costs one registry entry, one client call site, and no
migration.

### Recording an event

The client posts them fire-and-forget, either one at a time or batched:

```
POST /events
{ "name": "rebooking_offered",
  "flow_id": "m4x1k2-8fa0c3b1",
  "client_ts": 1710000000123,
  "props": { "person_ids": [12, 44], "minutes_ago": 7, "start_min": 615 } }

POST /events/batch
{ "events": [
    { "name": "booking_started", "flow_id": "m4x1k2-8fa0c3b1",
      "client_ts": 1710000000100,
      "props": { "prefilled_player_count": 0 } },
    { "name": "rebooking_offered", "flow_id": "m4x1k2-8fa0c3b1",
      "client_ts": 1710000000450,
      "props": { "person_ids": [12, 44], "minutes_ago": 7, "start_min": 615 } }
  ] }
```

Both routes answer `202` as soon as the body validates and store afterwards. A
storage failure is logged and never reaches the client — these fire in the
middle of a booking, so analytics must not be able to break one. `club`,
`actor` and `created` are filled in server-side and are not accepted from the
client. Optional `client_ts` is the client's `Date.now()` when the event was
enqueued (positive integer ms); it is stored as-is for within-batch ordering
and is not treated as authoritative time.

`POST /events/batch` accepts 1–50 events. It counts as one rate-limit unit and
persists with a multi-row insert. Batched rows share nearly the same server
`created` time; use `client_ts` for gaps between steps. Funnel joins still use
`flow_id`.

Events in a batch are validated one at a time and the valid ones are stored
even if others are not — a client buffers unrelated events together, so failing
the whole batch would let one broken call site delete a whole booking funnel's
worth of good data. The `202` reports what happened, and anything dropped is
also logged server-side:

```
{ "status": "ok", "accepted": 1,
  "rejected": [ { "index": 1, "name": "start_time_option_selected",
                  "fielderrors": [ { "param": "props.start_min",
                                     "msg": "Invalid input: expected number, received null" } ] } ] }
```

An empty batch, or one over 50 events, is still a `400` — that is a broken
client contract rather than bad data. `POST /events` is unchanged: with a
single event there is nothing to salvage, so an invalid one is a `400`.


`flow_id` is an opaque client-generated string that groups the events of one
user flow, which is what makes funnel questions answerable — "accepted but
never booked" is a join on `flow_id`, not something the per-event counts can
tell you. For match booking the client assigns one `flow_id` when the booking
screen opens and attaches it to every event in that attempt (players, court,
rebooking, submit), not only rebooking.

### Why players live in `props`

There is deliberately no foreign key from an event to `person`. Events outlive
the people in them: a cascade would silently delete history and change past
rates when a member is removed. The cost is that per-player reports expand the
array with `JSON_TABLE` and cannot name deleted members, so those rows can sum
to less than the daily totals.

At current volume no index on `person_ids` is needed. When it is, it is one
`ALTER` and no table change:

```sql
ALTER TABLE app_event
  ADD INDEX app_event_person_ids_idx
    ((CAST(props->'$.person_ids' AS UNSIGNED ARRAY)));
```

### Current events

Match booking funnel (one `flow_id` per booking screen session):

| Name | Emitted when | Props |
| --- | --- | --- |
| `booking_started` | booking screen opens | `prefilled_player_count` |
| `booking_player_set` | player dialog Save (add or edit) | `person_id`, `player_type`, `slot_index` |
| `booking_player_removed` | a player slot is removed | `person_id`, `slot_index` |
| `booking_players_cleared` | Clear all with players present | `person_ids` |
| `booking_activity_selected` | user changes activity | `activity_type` |
| `booking_court_selected` | user picks a court | `court_id` |
| `booking_duration_selected` | duration dialog OK | `duration_min`, `preferred_min` |
| `booking_bumpable_set` | user toggles bumpable | `bumpable` |
| `booking_step_continued` | continue past validation | `from_step`, `to_step` |
| `booking_completed` | booking created successfully | `person_ids`, `player_types`, `court_id`, `activity_type`, `start_min`, `duration_min`, `bumpable` |

Rebooking and start-time (same booking `flow_id` when emitted from match booking):

| Name | Emitted when | Props |
| --- | --- | --- |
| `rebooking_offered` | the back-to-back dialog is shown | `person_ids`, `minutes_ago`, `start_min` |
| `rebooking_accepted` | confirmed with the previous session's end time | `person_ids`, `start_min` |
| `rebooking_declined` | confirmed with "starting now" | `person_ids`, `start_min` |
| `rebooking_booked` | a booking followed an accepted suggestion | `person_ids`, `start_min`, `offered_start_min`, `kept_offer` |
| `start_time_option_selected` | a start-time menu pick is applied | `option` (`rebooking` \| `now` \| `plus5` \| `other`), `start_min` |
| `fast_rebook_completed` | Booking Details Fast rebook created a follow-on | `source_booking_id`, `person_ids`, `player_types`, `court_id`, `activity_type`, `start_min`, `duration_min`, `bumpable` |

Only committed user actions are recorded: auto-seeded start/duration, rule-driven
bumpable defaults, route-prefilled players, note text, and failed validation
attempts are not.

### Fast rebook (Booking Details)

The client posts a normal `POST /bookings` after the confirm dialog. There is
no dedicated Fast rebook route. That create path **does not** reject a session
whose end is already in the past — the follow-on is supposed to start at the
ended session's end even when the player taps late. Court overlap is exclusive
at the endpoints, so a follow-on that starts exactly when the previous session
ended does not collide with it.

`GET /bookings/:id` includes each player's `player_type_id` (as well as the
description) so the client can resolve a lineup without guessing types.

Fast rebook is not gated by `rebooking_prompt_enabled`. Concurrent-player
rejection still follows `prevent_concurrent_member_bookings`, the same as any
other `POST /bookings`.

### Reading the numbers

Two report processors, behind the usual admin/manager guard:

```
GET /reports/rebooking?from=2026-08-01&to=2026-08-08
GET /reports/rebookingplayers?from=2026-08-01&to=2026-08-08
```

`rebooking` returns one row per day — `offered`, `accepted`, `declined`,
`booked`, `booked_kept`, `booked_changed`, `accept_rate`, and `fast_rebooked`,
with empty days filled in. `fast_rebooked` is the Booking Details shortcut
and is not part of `accept_rate`. `rebookingplayers` returns offers, accepts
and declines per member, busiest first. Days are bucketed in the club's time
zone; `app_event.created` is UTC.

Accepting the suggestion is not the end of the story: the start time stays
editable afterwards, so an accepted suggestion can still be booked at a
different time. `rebooking_booked` therefore fires for every booking that
followed an acceptance and carries `kept_offer`, which splits the three
outcomes:

| Outcome | How to read it |
| --- | --- |
| kept | `booked_kept` — booked at the suggested time |
| edited | `booked_changed` — accepted, then the start time was changed |
| abandoned | `accepted` minus `booked` |

Derive "abandoned" over the whole range rather than per day: a flow that starts
before midnight and finishes after it puts its acceptance and its booking on
different days. The gap between `start_min` and `offered_start_min` on an
edited booking shows how far off the suggestion was.

"Abandoned" is not purely a user behaviour. A suggestion whose session ages out
of the rebooking window mid-flow is withdrawn by the client, which resets the
start time and cancels the acceptance, so it lands here too — the user never
declined and never booked at the suggested time. Reading this figure as "people
who changed their mind" overstates it when the club has long booking flows.

The same midnight split affects `accept_rate`, which is computed per day: a
dialog shown at 23:58 and answered at 00:01 puts the offer on one day and the
acceptance on the next, so a single day's rate can read above 1.0 (and the day
before it artificially low). Sum `accepted` and `offered` across the range
before dividing when the number needs to be exact.
