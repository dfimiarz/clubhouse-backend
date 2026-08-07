-- 0005_add_activity_type_behavior_columns (up)
-- Encodes UI/booking behavior on activity_type so clients and validators
-- do not hard-code well-known type ids:
--   calendar_style     — match | lesson | event (calendar card layout)
--   member_rebookable  — allow Book again → member match-booking flow
--   same_day_only      — booking date must be club-local today
ALTER TABLE `activity_type`
  ADD COLUMN `calendar_style` varchar(32) NOT NULL DEFAULT 'event'
    COMMENT 'Calendar card layout: match | lesson | event',
  ADD COLUMN `member_rebookable` tinyint(1) NOT NULL DEFAULT 0
    COMMENT 'Allow Book again into member match-booking flow',
  ADD COLUMN `same_day_only` tinyint(1) NOT NULL DEFAULT 0
    COMMENT 'Booking date must be club-local today';

UPDATE `activity_type` SET
  `calendar_style` = 'match',
  `member_rebookable` = 1,
  `same_day_only` = 1
WHERE `id` IN (1000, 1001);

UPDATE `activity_type` SET
  `calendar_style` = 'lesson'
WHERE `id` = 5000;

INSERT INTO `schema_migrations` (`version`) VALUES ('0005');
