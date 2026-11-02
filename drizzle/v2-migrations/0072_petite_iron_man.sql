CREATE TABLE "competition_qualification_drafts" (
	"season_id" uuid PRIMARY KEY NOT NULL,
	"order" jsonb NOT NULL,
	"format" "competition_qualification_format" NOT NULL,
	"target_entrant_count" integer NOT NULL,
	"version" integer NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competition_qualification_drafts_version_check" CHECK ("competition_qualification_drafts"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "event_rosters" ADD COLUMN "eligibility_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "competition_qualification_runs" ADD COLUMN "eligibility_policy" jsonb;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed New empty draft table; FK does not scan existing production data.
ALTER TABLE "competition_qualification_drafts" ADD CONSTRAINT "competition_qualification_drafts_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_qualification_drafts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE "competition_qualification_drafts" FROM anon, authenticated;
