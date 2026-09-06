-- 0017_drop_activity_start_end (down)
-- Restore TIME columns and backfill from UTC instants. TIME() wraps after
-- midnight, matching the pre-0017 column semantics. activities_view stays
-- dropped. Named IANA zones must resolve (mysql time zone tables loaded).

CREATE TEMPORARY TABLE `_0017_tz_check` (
  `ok` TINYINT NOT NULL,
  CONSTRAINT `_0017_named_time_zones_required` CHECK (`ok` = 1)
) ENGINE=InnoDB;
INSERT INTO `_0017_tz_check` (`ok`)
  SELECT IF(
    CONVERT_TZ('2026-01-15 12:00:00', 'America/New_York', 'UTC') IS NULL
    OR EXISTS (
      SELECT 1 FROM `club`
      WHERE CONVERT_TZ('2026-01-15 12:00:00', `time_zone`, 'UTC') IS NULL
    ),
    0,
    1
  );
DROP TEMPORARY TABLE `_0017_tz_check`;

ALTER TABLE `activity`
  ADD COLUMN `start` TIME NULL AFTER `date`,
  ADD COLUMN `end` TIME NULL AFTER `start`;

UPDATE `activity` a
JOIN `court` c ON c.id = a.court
JOIN `club` cl ON cl.id = c.club
SET
  a.start = TIME(CONVERT_TZ(a.start_at, 'UTC', cl.time_zone)),
  a.end   = TIME(CONVERT_TZ(a.end_at, 'UTC', cl.time_zone));

CREATE TEMPORARY TABLE `_0017_time_null_check` (
  `ok` TINYINT NOT NULL,
  CONSTRAINT `_0017_local_times_required` CHECK (`ok` = 1)
) ENGINE=InnoDB;
INSERT INTO `_0017_time_null_check` (`ok`)
SELECT IF(COUNT(*) = 0, 1, 0)
FROM `activity`
WHERE `start` IS NULL OR `end` IS NULL;
DROP TEMPORARY TABLE `_0017_time_null_check`;

ALTER TABLE `activity`
  MODIFY COLUMN `start` TIME NOT NULL,
  MODIFY COLUMN `end` TIME NOT NULL,
  ADD KEY `starttime` (`start`),
  ADD KEY `endtime` (`end`);

DELETE FROM `schema_migrations` WHERE `version` = '0017';
