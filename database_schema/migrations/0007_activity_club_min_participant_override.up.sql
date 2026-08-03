-- 0007_activity_club_min_participant_override (up)
-- Nullable per-club override for min_participant.
-- NULL = use activity_type.min_participant (global default).
ALTER TABLE `activity_club`
  ADD COLUMN `min_participant` int NULL DEFAULT NULL
    COMMENT 'NULL = use activity_type.min_participant; else club override';

INSERT INTO `schema_migrations` (`version`) VALUES ('0007');
