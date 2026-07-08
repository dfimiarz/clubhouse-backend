-- 0003_add_role_type_capability_columns (down)
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
    `rt`.`event_host` AS `event_host`
  FROM `membership` `m`
  JOIN `role` `r` ON `r`.`id` = `m`.`role`
  JOIN `role_type` `rt` ON `rt`.`id` = `r`.`type`
  JOIN `person` `p` ON `p`.`id` = `m`.`person_id`;

ALTER TABLE `role_type`
  DROP COLUMN `requires_pass`,
  DROP COLUMN `public_label`;

DELETE FROM `schema_migrations` WHERE `version` = '0003';
