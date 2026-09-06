-- 0016_activity_utc_instants (down)
-- addMatch, changeActivityTime, and splitAndMoveActivity stay dropped.
-- Restore them from database_schema/clubhouse_schema_lagacy_05_30_26.sql
-- if a non-app caller still needs them.
ALTER TABLE `activity`
  DROP KEY `activity_court_start_at`,
  DROP COLUMN `end_at`,
  DROP COLUMN `start_at`;

DELETE FROM `schema_migrations` WHERE `version` = '0016';
