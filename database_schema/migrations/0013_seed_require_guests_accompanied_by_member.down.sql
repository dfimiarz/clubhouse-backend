-- 0013_seed_require_guests_accompanied_by_member (down)
DELETE FROM `club_setting`
WHERE `setting_key` = 'require_guests_accompanied_by_member';

DELETE FROM `schema_migrations` WHERE `version` = '0013';
