-- 0007_activity_club_min_participant_override (down)
ALTER TABLE `activity_club`
  DROP COLUMN `min_participant`;

DELETE FROM `schema_migrations` WHERE `version` = '0007';
