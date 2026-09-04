CREATE TABLE "competition_entry_restriction_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"roster_revision_id" uuid NOT NULL,
	"restriction_code" text NOT NULL,
	"finding_snapshot" jsonb NOT NULL,
	"reason" text NOT NULL,
	"granted_by" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_by" text,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "competition_entry_restriction_overrides_revoke_shape_check" CHECK (("competition_entry_restriction_overrides"."revoked_at" IS NULL AND "competition_entry_restriction_overrides"."revoked_by" IS NULL) OR ("competition_entry_restriction_overrides"."revoked_at" IS NOT NULL AND "competition_entry_restriction_overrides"."revoked_by" IS NOT NULL)),
	CONSTRAINT "competition_entry_restriction_overrides_code_non_empty_check" CHECK (length(trim("competition_entry_restriction_overrides"."restriction_code")) > 0),
	CONSTRAINT "competition_entry_restriction_overrides_reason_non_empty_check" CHECK (length(trim("competition_entry_restriction_overrides"."reason")) > 0)
);
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "competition_entry_restriction_overrides" FROM anon, authenticated;
--> statement-breakpoint
ALTER TABLE "competition_entry_restriction_overrides" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- rivalhub:migration-risk: contract cleanup after the previous release stopped reading/writing <legacy qualification state>
ALTER TABLE "competition_entry_restriction_overrides" ADD CONSTRAINT "competition_entry_restriction_overrides_competition_id_seasons_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: contract cleanup after the previous release stopped reading/writing <legacy qualification state>
ALTER TABLE "competition_entry_restriction_overrides" ADD CONSTRAINT "competition_entry_restriction_overrides_entry_id_competition_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."competition_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: contract cleanup after the previous release stopped reading/writing <legacy qualification state>
ALTER TABLE "competition_entry_restriction_overrides" ADD CONSTRAINT "competition_entry_restriction_overrides_roster_revision_id_competition_entry_roster_revisions_id_fk" FOREIGN KEY ("roster_revision_id") REFERENCES "public"."competition_entry_roster_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: contract cleanup after the previous release stopped reading/writing <legacy qualification state>
ALTER TABLE "competition_entry_restriction_overrides" ADD CONSTRAINT "competition_entry_restriction_overrides_entry_competition_scope_fk" FOREIGN KEY ("entry_id","competition_id") REFERENCES "public"."competition_entries"("id","competition_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: contract cleanup after the previous release stopped reading/writing <legacy qualification state>
ALTER TABLE "competition_entry_restriction_overrides" ADD CONSTRAINT "competition_entry_restriction_overrides_revision_entry_scope_fk" FOREIGN KEY ("roster_revision_id","entry_id") REFERENCES "public"."competition_entry_roster_revisions"("id","entry_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: contract cleanup after the previous release stopped reading/writing <legacy qualification state>
CREATE UNIQUE INDEX "competition_entry_restriction_overrides_active_unique" ON "competition_entry_restriction_overrides" USING btree ("entry_id","roster_revision_id","restriction_code") WHERE "competition_entry_restriction_overrides"."revoked_at" IS NULL;--> statement-breakpoint
-- rivalhub:migration-risk: contract cleanup after the previous release stopped reading/writing <legacy qualification state>
CREATE INDEX "competition_entry_restriction_overrides_entry_idx" ON "competition_entry_restriction_overrides" USING btree ("entry_id","roster_revision_id");--> statement-breakpoint
-- rivalhub:migration-risk: contract cleanup after the previous release stopped reading/writing <legacy qualification state>
CREATE INDEX "competition_entry_restriction_overrides_competition_idx" ON "competition_entry_restriction_overrides" USING btree ("competition_id");
