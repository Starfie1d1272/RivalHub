CREATE TYPE "public"."major_result_status" AS ENUM('pending_confirmation', 'confirmed');--> statement-breakpoint
CREATE TABLE "major_final_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"playoff_stage_run_id" uuid NOT NULL,
	"champion_team_id" uuid NOT NULL,
	"placement_groups" jsonb NOT NULL,
	"status" "major_result_status" DEFAULT 'pending_confirmation' NOT NULL,
	"finalized_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finalized_by" text NOT NULL,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" text,
	CONSTRAINT "major_final_results_season_unique" UNIQUE("season_id"),
	CONSTRAINT "major_final_results_playoff_run_unique" UNIQUE("playoff_stage_run_id")
);
--> statement-breakpoint
ALTER TABLE "major_final_results" ADD CONSTRAINT "major_final_results_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "major_final_results" ADD CONSTRAINT "major_final_results_playoff_stage_run_id_major_stage_runs_id_fk" FOREIGN KEY ("playoff_stage_run_id") REFERENCES "public"."major_stage_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "major_final_results" ADD CONSTRAINT "major_final_results_champion_team_id_teams_id_fk" FOREIGN KEY ("champion_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "major_final_results_season_idx" ON "major_final_results" USING btree ("season_id");