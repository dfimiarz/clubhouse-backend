-- Preserve all pass types; restore manually assigned IDs.
SET @guest_pass_type_fk_checks = @@SESSION.foreign_key_checks;
SET SESSION foreign_key_checks = 0;
ALTER TABLE guest_pass_type MODIFY COLUMN id INT NOT NULL;
SET SESSION foreign_key_checks = @guest_pass_type_fk_checks;

DELETE FROM schema_migrations WHERE version = '0019';
