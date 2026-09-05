-- 0015_add_activity_origin (down)
ALTER TABLE `activity`
  DROP FOREIGN KEY `activity_origin_fk`,
  DROP COLUMN `origin_activity_id`;

DELETE FROM `schema_migrations` WHERE `version` = '0015';
