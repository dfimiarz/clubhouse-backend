-- 0004_add_activity_type_min_participant (down)
-- Removes Ball Machine seed row (only if unused) and drops min_participant.
DELETE FROM `activity_type` WHERE `id` = 1001;

ALTER TABLE `activity_type`
  DROP COLUMN `min_participant`;

DELETE FROM `schema_migrations` WHERE `version` = '0004';
