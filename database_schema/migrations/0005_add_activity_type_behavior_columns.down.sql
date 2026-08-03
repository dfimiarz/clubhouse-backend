-- 0005_add_activity_type_behavior_columns (down)
ALTER TABLE `activity_type`
  DROP COLUMN `calendar_style`,
  DROP COLUMN `member_rebookable`,
  DROP COLUMN `same_day_only`;

DELETE FROM `schema_migrations` WHERE `version` = '0005';
