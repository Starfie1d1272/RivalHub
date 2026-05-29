CREATE TABLE "player_ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"user_id" uuid,
	"steam_id_64" text NOT NULL,
	"rr_score" numeric(8, 4),
	"rr_weights_version" text,
	"prism_firepower" numeric(6, 2),
	"prism_opening" numeric(6, 2),
	"prism_clutch" numeric(6, 2),
	"prism_sniping" numeric(6, 2),
	"prism_survival" numeric(6, 2),
	"prism_utility" numeric(6, 2),
	"prism_trading" numeric(6, 2),
	"prism_entry" numeric(6, 2),
	"prism_weights_version" text,
	"map_count" integer DEFAULT 0 NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "player_ratings" ADD CONSTRAINT "player_ratings_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_ratings" ADD CONSTRAINT "player_ratings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "player_ratings_season_steam_uniq" ON "player_ratings" USING btree ("season_id","steam_id_64");