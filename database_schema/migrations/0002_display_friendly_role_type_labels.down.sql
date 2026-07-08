-- 0002_display_friendly_role_type_labels (down)
UPDATE `role_type` SET `label` = 'GUEST' WHERE `id` = 100;
UPDATE `role_type` SET `label` = 'RESTRICTED_MEMBER' WHERE `id` = 200;
UPDATE `role_type` SET `label` = 'MEMBER' WHERE `id` = 300;
UPDATE `role_type` SET `label` = 'INSTRUCTOR' WHERE `id` = 350;
UPDATE `role_type` SET `label` = 'MANAGER' WHERE `id` = 400;
UPDATE `role_type` SET `label` = 'SYSADMIN' WHERE `id` = 1000;

DELETE FROM `schema_migrations` WHERE `version` = '0002';
