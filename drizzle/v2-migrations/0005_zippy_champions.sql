CREATE TYPE "public"."match_ownership" AS ENUM('manual', 'major_stage');--> statement-breakpoint
CREATE TABLE "major_stage_entrants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stage_run_id" uuid NOT NULL,
	"entrant_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"tournament_seed" integer NOT NULL,
	"stage_seed" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "major_stage_entrants_run_entrant_unique" UNIQUE("stage_run_id","entrant_id"),
	CONSTRAINT "major_stage_entrants_run_team_unique" UNIQUE("stage_run_id","team_id"),
	CONSTRAINT "major_stage_entrants_run_seed_unique" UNIQUE("stage_run_id","stage_seed"),
	CONSTRAINT "major_stage_entrants_stage_seed_range_check" CHECK ("major_stage_entrants"."stage_seed" BETWEEN 1 AND 16)
);
--> statement-breakpoint
CREATE TABLE "major_stage_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"stage_key" text NOT NULL,
	"rule_snapshot" jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_by" text NOT NULL,
	CONSTRAINT "major_stage_runs_season_stage_unique" UNIQUE("season_id","stage_key")
);
--> statement-breakpoint
ALTER TABLE "major_prestart_states" ADD COLUMN "seeds_locked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "major_prestart_states" ADD COLUMN "seeds_locked_by" text;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "ownership" "match_ownership" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "major_stage_run_id" uuid;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "managed_key" text;--> statement-breakpoint
ALTER TABLE "major_stage_entrants" ADD CONSTRAINT "major_stage_entrants_stage_run_id_major_stage_runs_id_fk" FOREIGN KEY ("stage_run_id") REFERENCES "public"."major_stage_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "major_stage_entrants" ADD CONSTRAINT "major_stage_entrants_entrant_id_major_prestart_entrants_id_fk" FOREIGN KEY ("entrant_id") REFERENCES "public"."major_prestart_entrants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "major_stage_entrants" ADD CONSTRAINT "major_stage_entrants_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "major_stage_runs" ADD CONSTRAINT "major_stage_runs_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "major_stage_entrants_run_idx" ON "major_stage_entrants" USING btree ("stage_run_id");--> statement-breakpoint
CREATE INDEX "major_stage_runs_season_idx" ON "major_stage_runs" USING btree ("season_id");--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_major_stage_run_id_major_stage_runs_id_fk" FOREIGN KEY ("major_stage_run_id") REFERENCES "public"."major_stage_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "matches_major_stage_run_managed_key_unique" ON "matches" USING btree ("major_stage_run_id","managed_key") WHERE "matches"."ownership" = 'major_stage';--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_managed_major_match_shape" CHECK (("matches"."ownership" = 'manual' AND "matches"."major_stage_run_id" IS NULL AND "matches"."managed_key" IS NULL)
      OR ("matches"."ownership" = 'major_stage' AND "matches"."major_stage_run_id" IS NOT NULL AND "matches"."managed_key" IS NOT NULL));