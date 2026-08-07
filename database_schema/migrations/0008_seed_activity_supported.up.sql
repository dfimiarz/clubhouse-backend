-- 0008_seed_activity_supported (up)
-- Seed full court × activity_type matrix so booking stays unrestricted
-- until rows are removed. Courts are club-scoped, so this is per-club
-- without a club_id column on activity_supported.
INSERT INTO `activity_supported` (`court`, `activity_type`)
SELECT c.id, at.id
FROM `court` c
CROSS JOIN `activity_type` at;

INSERT INTO `schema_migrations` (`version`) VALUES ('0008');
