CREATE TABLE "major_tournament_seeds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"entrant_id" uuid NOT NULL,
	"tournament_seed" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "major_tournament_seeds_season_entrant_unique" UNIQUE("season_id","entrant_id"),
	CONSTRAINT "major_tournament_seeds_season_seed_unique" UNIQUE("season_id","tournament_seed"),
	CONSTRAINT "major_tournament_seeds_seed_range_check" CHECK ("major_tournament_seeds"."tournament_seed" BETWEEN 1 AND 32)
);
--> statement-breakpoint
ALTER TABLE "major_tournament_seeds" ADD CONSTRAINT "major_tournament_seeds_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "major_tournament_seeds" ADD CONSTRAINT "major_tournament_seeds_entrant_id_major_prestart_entrants_id_fk" FOREIGN KEY ("entrant_id") REFERENCES "public"."major_prestart_entrants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "major_tournament_seeds_season_idx" ON "major_tournament_seeds" USING btree ("season_id");