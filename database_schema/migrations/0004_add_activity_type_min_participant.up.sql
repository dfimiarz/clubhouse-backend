-- 0004_add_activity_type_min_participant (up)
-- Adds min_participant to activity_type so each activity can require a
-- minimum number of players at booking time (default 1).
-- Match (1000) requires 2; Ball Machine (1001) is seeded with 1.
ALTER TABLE `activity_type`
  ADD COLUMN `min_participant` int NOT NULL DEFAULT 1
    COMMENT 'Minimum participants required to book this activity';

UPDATE `activity_type` SET `min_participant` = 2 WHERE `id` = 1000;

INSERT INTO `activity_type` (`id`, `group`, `lbl`, `desc`, `restricted`, `min_participant`)
VALUES (1001, 1, 'BALL_MACHINE', 'Ball Machine', 0, 1)
ON DUPLICATE KEY UPDATE
  `min_participant` = VALUES(`min_participant`),
  `lbl` = VALUES(`lbl`),
  `desc` = VALUES(`desc`),
  `restricted` = VALUES(`restricted`);

INSERT INTO `schema_migrations` (`version`) VALUES ('0004');
