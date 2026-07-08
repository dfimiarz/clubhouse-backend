-- 0002_display_friendly_role_type_labels (up)
-- Replaces the enum-style role_type label codes (GUEST, RESTRICTED_MEMBER, ...)
-- with display-friendly names. Safe: no code compares these strings — role types
-- are always identified by numeric id (utils/dbconstants.js).
UPDATE `role_type` SET `label` = 'Guest' WHERE `id` = 100;
UPDATE `role_type` SET `label` = 'Restricted Member' WHERE `id` = 200;
UPDATE `role_type` SET `label` = 'Member' WHERE `id` = 300;
UPDATE `role_type` SET `label` = 'Instructor' WHERE `id` = 350;
UPDATE `role_type` SET `label` = 'Manager' WHERE `id` = 400;
UPDATE `role_type` SET `label` = 'Sysadmin' WHERE `id` = 1000;

INSERT INTO `schema_migrations` (`version`) VALUES ('0002');
