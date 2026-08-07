-- 0006_add_activity_club (up)
-- Junction table: which global activity_type rows each club offers.
-- Presence of a row = enabled for that club. Catalog definitions stay on activity_type.
CREATE TABLE `activity_club` (
  `club_id` int NOT NULL,
  `activity_type_id` int NOT NULL,
  PRIMARY KEY (`club_id`, `activity_type_id`),
  KEY `activity_club_type_fk_idx` (`activity_type_id`),
  CONSTRAINT `activity_club_club_fk`
    FOREIGN KEY (`club_id`) REFERENCES `club` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `activity_club_type_fk`
    FOREIGN KEY (`activity_type_id`) REFERENCES `activity_type` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT 'Which activity types are available for a club';

-- Preserve current behavior: every club can use every existing type
INSERT INTO `activity_club` (`club_id`, `activity_type_id`)
SELECT c.id, at.id
FROM `club` c
CROSS JOIN `activity_type` at;

INSERT INTO `schema_migrations` (`version`) VALUES ('0006');
