CREATE TYPE "public"."competition_entry_roster_revision_origin" AS ENUM('initial', 'admin_remediation', 'self_roster_change');--> statement-breakpoint
ALTER TABLE "competition_entry_roster_revisions" ADD COLUMN "origin" "competition_entry_roster_revision_origin" DEFAULT 'initial' NOT NULL;--> statement-breakpoint
UPDATE "competition_entry_roster_revisions" AS revision
SET "origin" = 'admin_remediation'
FROM "competition_entries" AS entry
WHERE revision.id = entry.current_roster_revision_id
  AND revision.entry_id = entry.id
  AND entry.registration_status = 'changes_requested';
