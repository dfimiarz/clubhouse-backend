-- 0016_activity_utc_instants (down)
ALTER TABLE `activity`
  DROP KEY `activity_court_start_at`,
  DROP COLUMN `end_at`,
  DROP COLUMN `start_at`;

DELETE FROM `schema_migrations` WHERE `version` = '0016';
