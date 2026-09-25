-- rivalhub:migration-risk: contract-cleanup steam_profiles is the official authority and the N/N+1 rollback shadow window has ended; no shipped consumer remains.
ALTER TABLE "users" DROP COLUMN "steam_name", DROP COLUMN "steam_profile_url", DROP COLUMN "avatar_url";
