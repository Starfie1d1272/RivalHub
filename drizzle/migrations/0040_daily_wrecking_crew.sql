CREATE TABLE "major_seed_recommendation_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"entrant_set_fingerprint" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"context" jsonb NOT NULL,
	"recommendations" jsonb NOT NULL,
	CONSTRAINT "major_seed_recommendation_snapshots_season_id_unique" UNIQUE("season_id")
);
--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed reviewed the new season foreign key; this table is created empty and the constraint is validated during migration replay.
ALTER TABLE "major_seed_recommendation_snapshots" ADD CONSTRAINT "major_seed_recommendation_snapshots_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;
