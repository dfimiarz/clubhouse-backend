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
| `rebooking_prompt_enabled` | boolean | `false` | Show the back-to-back rebooking prompt in the match booking flow. Opt-in: set to `'1'` per club |

There is no write endpoint or admin UI yet — values are changed with SQL.
