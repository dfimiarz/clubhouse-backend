-- 0017_drop_activity_start_end (up)
-- Drop leftover club-local TIME columns. start_at/end_at are the source of
-- truth; the Node app no longer writes `start`/`end`. Keep `date` as the
-- session-start business day.
-- Apply with the app that omits these columns from INSERT/UPDATE.

DROP VIEW IF EXISTS `activities_view`;

ALTER TABLE `activity`
  DROP KEY `starttime`,
  DROP KEY `endtime`,
  DROP COLUMN `start`,
  DROP COLUMN `end`;

INSERT INTO `schema_migrations` (`version`) VALUES ('0017');
