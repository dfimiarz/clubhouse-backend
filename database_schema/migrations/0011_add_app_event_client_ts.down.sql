-- 0011_add_app_event_client_ts (down)
ALTER TABLE `app_event`
  DROP COLUMN `client_ts`;

DELETE FROM `schema_migrations` WHERE `version` = '0011';
