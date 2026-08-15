-- 0013_seed_require_guests_accompanied_by_member (up)
-- Enable the guest-must-be-accompanied rule for every existing club.
-- INSERT IGNORE keeps a row a club already set by hand.
INSERT IGNORE INTO `club_setting` (`club`, `setting_key`, `setting_value`)
SELECT c.id, 'require_guests_accompanied_by_member', '1'
FROM `club` c;

INSERT INTO `schema_migrations` (`version`) VALUES ('0013');
