-- Reverting this feature discards its per-club overrides.
DELETE FROM club_setting WHERE setting_key = 'session_duration_policy';
ALTER TABLE club_setting MODIFY setting_value VARCHAR(255) NOT NULL;

DELETE FROM schema_migrations WHERE version = '0018';
