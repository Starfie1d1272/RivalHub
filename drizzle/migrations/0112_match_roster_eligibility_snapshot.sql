ALTER TABLE "match_rosters" ADD COLUMN "eligibility_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "match_rosters" ADD COLUMN "source_roster_revision_id" uuid REFERENCES "competition_entry_roster_revisions"("id");--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed Existing rows have null identity; validation takes a brief table lock.
ALTER TABLE "match_rosters" ADD CONSTRAINT "match_rosters_revision_entry_scope_fk" FOREIGN KEY ("source_roster_revision_id", "entry_id") REFERENCES "competition_entry_roster_revisions"("id", "entry_id");--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed Existing rows have both new columns null; validation takes a brief table lock.
ALTER TABLE "match_rosters" ADD CONSTRAINT "match_rosters_eligibility_identity_shape_check" CHECK (("source_roster_revision_id" IS NULL) = ("eligibility_snapshot" IS NULL));
