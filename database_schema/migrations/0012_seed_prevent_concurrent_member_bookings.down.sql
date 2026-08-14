-- 0012_seed_prevent_concurrent_member_bookings (down)
DELETE FROM `club_setting`
WHERE `setting_key` = 'prevent_concurrent_member_bookings';

DELETE FROM `schema_migrations` WHERE `version` = '0012';
