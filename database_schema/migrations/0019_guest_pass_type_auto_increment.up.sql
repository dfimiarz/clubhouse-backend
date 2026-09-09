-- Allocate IDs safely when administrators create pass types.
-- MySQL blocks changes to a referenced column even when its type and values
-- stay the same. Suspend checks only in this session for the attribute change.
SET @guest_pass_type_fk_checks = @@SESSION.foreign_key_checks;
SET SESSION foreign_key_checks = 0;
ALTER TABLE guest_pass_type MODIFY COLUMN id INT NOT NULL AUTO_INCREMENT;
SET SESSION foreign_key_checks = @guest_pass_type_fk_checks;

INSERT INTO schema_migrations (version) VALUES ('0019');
