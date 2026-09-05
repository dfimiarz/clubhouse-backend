-- 0015_add_activity_origin (up)
-- Self-FK grouping court/time-move rows as one play session.
-- A new booking inserts NULL then sets origin_activity_id = id in the
-- same transaction (AUTO_INCREMENT is not known at INSERT time).
-- Continuations copy the source row's origin.
ALTER TABLE `activity`
  ADD COLUMN `origin_activity_id` INT NULL
    COMMENT 'First activity.id in this play session; court/time moves share it',
  ADD CONSTRAINT `activity_origin_fk`
    FOREIGN KEY (`origin_activity_id`) REFERENCES `activity` (`id`);

UPDATE `activity`
SET `origin_activity_id` = `id`
WHERE `origin_activity_id` IS NULL;

INSERT INTO `schema_migrations` (`version`) VALUES ('0015');
