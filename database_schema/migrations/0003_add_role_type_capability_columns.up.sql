-- 0003_add_role_type_capability_columns (up)
-- Adds capability/display flags to role_type so role behavior is data-driven
-- instead of keyed to well-known ids in code:
--   requires_pass — person must hold an active guest pass to play
--   public_label  — redacted role label shown to all members (never reveals
--                   privileged roles like Manager/Admin on player cards)
-- Also extends membership_view to expose both per person.
ALTER TABLE `role_type`
  ADD COLUMN `requires_pass` tinyint(1) NOT NULL DEFAULT '0' COMMENT 'Requires an active pass to play',
  ADD COLUMN `public_label` varchar(32) NOT NULL DEFAULT 'Member' COMMENT 'Role label shown to all members';

UPDATE `role_type` SET `requires_pass` = 1, `public_label` = 'Guest' WHERE `id` = 100;

ALTER VIEW `membership_view` AS
  SELECT
    `p`.`id` AS `id`,
    `p`.`firstname` AS `firstname`,
    `p`.`lastname` AS `lastname`,
    `p`.`email` AS `email`,
    `p`.`club` AS `club`,
    `m`.`valid_from` AS `valid_from`,
    `m`.`valid_until` AS `valid_until`,
    `m`.`role` AS `role`,
    `r`.`lbl` AS `role_name`,
    `rt`.`id` AS `role_type_id`,
    `rt`.`label` AS `role_type_name`,
    `rt`.`guest_host` AS `guest_host`,
    `rt`.`event_host` AS `event_host`,
    `rt`.`requires_pass` AS `requires_pass`,
    `rt`.`public_label` AS `public_label`
  FROM `membership` `m`
  JOIN `role` `r` ON `r`.`id` = `m`.`role`
  JOIN `role_type` `rt` ON `rt`.`id` = `r`.`type`
  JOIN `person` `p` ON `p`.`id` = `m`.`person_id`;

INSERT INTO `schema_migrations` (`version`) VALUES ('0003');
