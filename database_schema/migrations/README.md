# Database migrations

Plain SQL migrations, run by hand with the `mysql` client. No tooling or dependencies.

## Convention

- Each change is a numbered pair: `NNNN_short_name.up.sql` and `NNNN_short_name.down.sql`.
- Prefix is a zero-padded sequential number (`0001`, `0002`, …).
- `*.up.sql` applies the change; `*.down.sql` reverts it.
- Every `*.up.sql` ends with `INSERT INTO schema_migrations (version) VALUES ('NNNN');`
  and every `*.down.sql` ends with the matching `DELETE`. This is bookkeeping only —
  nothing reads it automatically; it just lets you see what's applied:

  ```sql
  SELECT * FROM schema_migrations ORDER BY version;
  ```

`0000_create_schema_migrations.up.sql` creates that tracking table and is run once per
database before any other migration.

## Running a migration

Against a local or legacy DB:

```bash
mysql -h <host> -u <user> -p clubhouse < 0000_create_schema_migrations.up.sql
mysql -h <host> -u <user> -p clubhouse < 0001_add_about_section_and_images.up.sql
```

Against the Docker dev DB:

```bash
docker exec -i clubhouse_database-mysql-1 sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" clubhouse' \
  < 0001_add_about_section_and_images.up.sql
```

To revert, run the matching `*.down.sql` the same way.

## Upgrading the live legacy database

The original upgrade added `about_section` and `images` in `0001`. The current
backend also depends on later migrations; applying only `0001` is insufficient.

1. Run `0000_create_schema_migrations.up.sql` (creates the tracking table).
2. Inspect the schema and `schema_migrations` to identify already-applied changes.
3. Review and apply missing `*.up.sql` files in numeric order, currently through
   `0018_expand_club_setting_value.up.sql`.

Read each migration before applying or reverting it. Later migrations change
data and remove columns: `0016` backfills UTC activity instants and requires
loaded MySQL named time zones; `0017` removes the legacy `start`/`end` columns;
`0018` expands setting values for duration policies. Reverts may remove saved
overrides or require a compatible backend version.

## Marking the current dev DB as already migrated

If a dev DB already has the changes from `0000` and `0001`, verify their schema
before recording them as applied:

```sql
INSERT IGNORE INTO schema_migrations (version) VALUES ('0000'),('0001');
```

This only records those two versions. Check later migrations individually;
do not mark them applied solely because the original two tables exist.

## Adding a new migration

1. Create `NNNN_short_name.up.sql` and `NNNN_short_name.down.sql` using the next number.
2. End the `up` file with the `schema_migrations` insert, the `down` file with the delete.
3. Apply with `mysql < file`, then commit both files.
