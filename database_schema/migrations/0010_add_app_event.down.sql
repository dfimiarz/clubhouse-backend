-- 0010_add_app_event (down)
DROP TABLE IF EXISTS `app_event`;

DELETE FROM `schema_migrations` WHERE `version` = '0010';
