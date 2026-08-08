-- 0009_add_club_setting (up)
-- Generic per-club key/value overrides. Rows are overrides only: keys, types,
-- defaults and visibility live in the backend registry (club/settings.js), so a
-- new setting needs no migration. Unknown keys here are ignored by the reader.
CREATE TABLE `club_setting` (
  `club` int NOT NULL,
  `setting_key` varchar(64) NOT NULL,
  `setting_value` varchar(255) NOT NULL,
  PRIMARY KEY (`club`, `setting_key`),
  CONSTRAINT `club_setting_club_fk`
    FOREIGN KEY (`club`) REFERENCES `club` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT 'Per-club setting overrides; defaults live in code';

INSERT INTO `schema_migrations` (`version`) VALUES ('0009');
