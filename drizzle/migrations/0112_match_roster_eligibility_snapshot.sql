ALTER TABLE "match_rosters" ADD COLUMN "source_roster_revision_id" uuid;--> statement-breakpoint
ALTER TABLE "match_rosters" ADD COLUMN "eligibility_snapshot" jsonb;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed Existing rows have null identity; validation takes a brief table lock.
ALTER TABLE "match_rosters" ADD CONSTRAINT "match_rosters_source_roster_revision_id_competition_entry_roster_revisions_id_fk" FOREIGN KEY ("source_roster_revision_id") REFERENCES "public"."competition_entry_roster_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed Existing rows have null identity; validation takes a brief table lock.
ALTER TABLE "match_rosters" ADD CONSTRAINT "match_rosters_revision_entry_scope_fk" FOREIGN KEY ("source_roster_revision_id","entry_id") REFERENCES "public"."competition_entry_roster_revisions"("id","entry_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed Existing rows have both new columns null; validation takes a brief table lock.
ALTER TABLE "match_rosters" ADD CONSTRAINT "match_rosters_eligibility_identity_shape_check" CHECK (("match_rosters"."source_roster_revision_id" IS NULL) = ("match_rosters"."eligibility_snapshot" IS NULL));
