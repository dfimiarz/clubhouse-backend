-- 0001_add_about_section_and_images (down)
DROP TABLE IF EXISTS `images`;
DROP TABLE IF EXISTS `about_section`;
DELETE FROM `schema_migrations` WHERE `version` = '0001';
