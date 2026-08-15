-- 0014_add_guest_pass_type_setting (down)
DROP TABLE IF EXISTS `guest_pass_type_setting`;

DELETE FROM `schema_migrations` WHERE `version` = '0014';
