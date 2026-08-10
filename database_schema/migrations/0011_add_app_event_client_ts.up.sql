-- 0011_add_app_event_client_ts (up)
-- Client-side event time (ms since epoch) so batched events keep meaningful
-- ordering; server `created` is still set at insert and is nearly identical
-- for every row in a multi-row batch.
ALTER TABLE `app_event`
  ADD COLUMN `client_ts` bigint unsigned DEFAULT NULL
    COMMENT 'Client Date.now() at enqueue; ms since epoch'
    AFTER `flow_id`;

INSERT INTO `schema_migrations` (`version`) VALUES ('0011');
