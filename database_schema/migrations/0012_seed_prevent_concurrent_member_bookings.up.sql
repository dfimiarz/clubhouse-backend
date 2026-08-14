-- 0012_seed_prevent_concurrent_member_bookings (up)
-- Enable the member-group player-overlap rule for every existing club.
-- INSERT IGNORE keeps a row a club already set by hand.
INSERT IGNORE INTO `club_setting` (`club`, `setting_key`, `setting_value`)
SELECT c.id, 'prevent_concurrent_member_bookings', '1'
FROM `club` c;

INSERT INTO `schema_migrations` (`version`) VALUES ('0012');
