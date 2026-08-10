-- 0010_add_app_event (up)
-- Generic product analytics events. Event names and the shape of `props` live
-- in the backend registry (analytics/eventTypes.js), so a new event type needs
-- no migration. Everything specific to an event, players included, is carried
-- in `props`; there is deliberately no foreign key to `person`, so deleting a
-- member cannot retroactively erase events and change historical rates.
CREATE TABLE `app_event` (
  `id`      bigint unsigned NOT NULL AUTO_INCREMENT,
  `club`    int NOT NULL,
  `name`    varchar(64) NOT NULL,
  `created` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `actor`   varchar(255) DEFAULT NULL,
  `flow_id` varchar(64) DEFAULT NULL,
  `props`   json DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `app_event_name_created_idx` (`club`, `name`, `created`),
  KEY `app_event_flow_idx` (`flow_id`),
  CONSTRAINT `app_event_club_fk`
    FOREIGN KEY (`club`) REFERENCES `club` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT 'Generic product analytics events; names and prop shapes live in code';

-- No index on props->'$.person_ids' yet: at a few rows per booking flow the
-- per-player report scans a trivially small set. When volume justifies it, add
-- a multi-valued index (MySQL 8.0.17+) without touching the table:
--   ALTER TABLE app_event
--     ADD INDEX app_event_person_ids_idx
--       ((CAST(props->'$.person_ids' AS UNSIGNED ARRAY)));

INSERT INTO `schema_migrations` (`version`) VALUES ('0010');
