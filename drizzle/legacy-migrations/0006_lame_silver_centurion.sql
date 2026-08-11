CREATE TABLE "swiss_standings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"stage" text NOT NULL,
	"team_id" uuid NOT NULL,
	"seed" integer NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"bu_score" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	CONSTRAINT "swiss_standings_season_id_stage_team_id_unique" UNIQUE("season_id","stage","team_id")
);
--> statement-breakpoint
ALTER TABLE "swiss_standings" ADD CONSTRAINT "swiss_standings_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swiss_standings" ADD CONSTRAINT "swiss_standings_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;