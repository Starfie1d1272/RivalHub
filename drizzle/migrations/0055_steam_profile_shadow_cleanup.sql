-- rivalhub:migration-risk: contract-cleanup v2.12.2 is Production without readers or writers for these shadow columns; no shipped consumer remains.
ALTER TABLE "public"."users" DROP COLUMN "steam_name", DROP COLUMN "steam_profile_url", DROP COLUMN "avatar_url";
