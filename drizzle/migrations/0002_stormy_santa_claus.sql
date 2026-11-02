ALTER TABLE "public"."competition_entry_roster_revisions" ADD COLUMN "position_facts_version" integer;
--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed Nullable marker is null for existing rows; the check verifies only null or version 1.
ALTER TABLE "public"."competition_entry_roster_revisions" ADD CONSTRAINT "competition_entry_roster_revisions_position_facts_version_check" CHECK ("competition_entry_roster_revisions"."position_facts_version" IS NULL OR "competition_entry_roster_revisions"."position_facts_version" = 1);