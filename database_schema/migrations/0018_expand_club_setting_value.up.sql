-- Structured session duration policies exceed the original 255-character limit.
ALTER TABLE club_setting MODIFY setting_value TEXT NOT NULL;

INSERT INTO schema_migrations (version) VALUES ('0018');
