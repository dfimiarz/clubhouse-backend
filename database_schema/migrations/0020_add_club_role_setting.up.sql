-- Restricted-member rules are per club because role is a global catalog.
CREATE TABLE `club_role_setting` (
  `club` int NOT NULL,
  `role` int NOT NULL,
  `setting_key` varchar(64) NOT NULL,
  `setting_value` varchar(255) NOT NULL,
  PRIMARY KEY (`club`, `role`, `setting_key`),
  CONSTRAINT `club_role_setting_club_fk` FOREIGN KEY (`club`) REFERENCES `club` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `club_role_setting_role_fk` FOREIGN KEY (`role`) REFERENCES `role` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO `schema_migrations` (`version`) VALUES ('0020');
