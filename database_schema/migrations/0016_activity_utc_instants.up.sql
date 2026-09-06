-- 0016_activity_utc_instants (up)
-- Persist activity start/end as UTC DATETIME instants. club-local `date` stays
-- the session-start business day; `start`/`end` TIME columns are dual-written.
-- Named IANA zones must resolve (mysql time zone tables loaded).

-- CONVERT_TZ returns NULL when mysql.time_zone_name is empty or the club
-- zone is unknown. Fail before backfill so we never persist NULL instants.
CREATE TEMPORARY TABLE `_0016_tz_check` (
  `ok` TINYINT NOT NULL,
  CONSTRAINT `_0016_named_time_zones_required` CHECK (`ok` = 1)
) ENGINE=InnoDB;
INSERT INTO `_0016_tz_check` (`ok`)
  SELECT IF(
    CONVERT_TZ('2026-01-15 12:00:00', 'America/New_York', 'UTC') IS NULL
    OR EXISTS (
      SELECT 1 FROM `club`
      WHERE CONVERT_TZ('2026-01-15 12:00:00', `time_zone`, 'UTC') IS NULL
    ),
    0,
    1
  );
DROP TEMPORARY TABLE `_0016_tz_check`;

-- MySQL normalizes nonexistent spring-forward times instead of returning
-- NULL. Require each local datetime to survive a UTC round trip before any
-- persistent changes, so invalid historical rows can be fixed and retried.
-- Wrapped ends belong to the next LOCAL day, whose UTC offset may differ.
CREATE TEMPORARY TABLE `_0016_local_time_check` (
  `ok` TINYINT NOT NULL,
  CONSTRAINT `_0016_local_times_must_round_trip` CHECK (`ok` = 1)
) ENGINE=InnoDB;
INSERT INTO `_0016_local_time_check` (`ok`)
SELECT IF(COUNT(*) = 0, 1, 0)
FROM (
  SELECT
    TIMESTAMP(a.date, a.start) AS local_start,
    TIMESTAMP(DATE_ADD(a.date, INTERVAL IF(a.end < a.start, 1, 0) DAY), a.end) AS local_end,
    cl.time_zone
  FROM `activity` a
  JOIN `court` c ON c.id = a.court
  JOIN `club` cl ON cl.id = c.club
) AS local_times
WHERE NOT (CONVERT_TZ(CONVERT_TZ(local_start, time_zone, 'UTC'), 'UTC', time_zone) <=> local_start)
   OR NOT (CONVERT_TZ(CONVERT_TZ(local_end, time_zone, 'UTC'), 'UTC', time_zone) <=> local_end);
DROP TEMPORARY TABLE `_0016_local_time_check`;

ALTER TABLE `activity`
  ADD COLUMN `start_at` DATETIME NULL
    COMMENT 'UTC instant' AFTER `end`,
  ADD COLUMN `end_at` DATETIME NULL
    COMMENT 'UTC instant' AFTER `start_at`;

UPDATE `activity` a
JOIN `court` c ON c.id = a.court
JOIN `club` cl ON cl.id = c.club
SET
  a.start_at = CONVERT_TZ(TIMESTAMP(a.date, a.start), cl.time_zone, 'UTC'),
  a.end_at   = CONVERT_TZ(
    TIMESTAMP(DATE_ADD(a.date, INTERVAL IF(a.end < a.start, 1, 0) DAY), a.end),
    cl.time_zone,
    'UTC'
  );

-- Guard against incomplete backfills or conversions that still returned NULL.
CREATE TEMPORARY TABLE `_0016_utc_null_check` (
  `ok` TINYINT NOT NULL,
  CONSTRAINT `_0016_utc_instants_required` CHECK (`ok` = 1)
) ENGINE=InnoDB;
INSERT INTO `_0016_utc_null_check` (`ok`)
SELECT IF(COUNT(*) = 0, 1, 0)
FROM `activity`
WHERE start_at IS NULL OR end_at IS NULL;
DROP TEMPORARY TABLE `_0016_utc_null_check`;

-- Zero-duration historical rows (start = end) are kept. Fail only on NULL
-- or inverted instants.
CREATE TEMPORARY TABLE `_0016_utc_backfill_check` (
  `ok` TINYINT NOT NULL,
  CONSTRAINT `_0016_active_utc_instants_required` CHECK (`ok` = 1)
) ENGINE=InnoDB;
INSERT INTO `_0016_utc_backfill_check` (`ok`)
SELECT IF(COUNT(*) = 0, 1, 0)
FROM `activity`
WHERE `active` = 1
  AND (start_at IS NULL OR end_at IS NULL OR start_at > end_at);
DROP TEMPORARY TABLE `_0016_utc_backfill_check`;

ALTER TABLE `activity`
  MODIFY COLUMN `start_at` DATETIME NOT NULL COMMENT 'UTC instant',
  MODIFY COLUMN `end_at` DATETIME NOT NULL COMMENT 'UTC instant',
  ADD KEY `activity_court_start_at` (`court`, `start_at`, `end_at`);

INSERT INTO `schema_migrations` (`version`) VALUES ('0016');
