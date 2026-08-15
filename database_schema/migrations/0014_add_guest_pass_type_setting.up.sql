-- 0014_add_guest_pass_type_setting (up)
-- Per-pass-type rule overrides. Keys, types, and defaults live in
-- guest-pass-types/settings.js. A type with no row for a key is unrestricted.
CREATE TABLE `guest_pass_type_setting` (
  `pass_type` int NOT NULL,
  `setting_key` varchar(64) NOT NULL,
  `setting_value` varchar(255) NOT NULL,
  PRIMARY KEY (`pass_type`, `setting_key`),
  CONSTRAINT `gpt_setting_type_fk`
    FOREIGN KEY (`pass_type`) REFERENCES `guest_pass_type` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT 'Per-pass-type setting overrides; defaults live in code';

INSERT INTO `schema_migrations` (`version`) VALUES ('0014');
