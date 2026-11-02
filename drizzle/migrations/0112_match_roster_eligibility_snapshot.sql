ALTER TABLE "match_rosters" ADD COLUMN "eligibility_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "match_rosters" ADD COLUMN "source_roster_revision_id" uuid REFERENCES "competition_entry_roster_revisions"("id");
