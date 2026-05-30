-- 0001_add_about_section_and_images (up)
-- Brings the legacy schema up to the current schema by adding the two new,
-- fully additive tables present in the current DB but missing from the legacy one.
CREATE TABLE `about_section` (
  `id` int NOT NULL AUTO_INCREMENT,
  `club` int NOT NULL,
  `title` varchar(255) DEFAULT NULL,
  `sort_order` int NOT NULL DEFAULT '0',
  `image_url` varchar(500) DEFAULT NULL,
  `text_content` text NOT NULL,
  PRIMARY KEY (`id`),
  KEY `club` (`club`),
  CONSTRAINT `about_section_ibfk_1` FOREIGN KEY (`club`) REFERENCES `club` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `images` (
  `club` int NOT NULL COMMENT 'Club Id',
  `name` varchar(32) NOT NULL COMMENT 'Image Name',
  `src` text NOT NULL COMMENT 'Image Path',
  UNIQUE KEY `unique_image_name_pk` (`club`,`name`),
  CONSTRAINT `images_club_id_fk` FOREIGN KEY (`club`) REFERENCES `club` (`id`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Images used by clubs';

INSERT INTO `schema_migrations` (`version`) VALUES ('0001');
