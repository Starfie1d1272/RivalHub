CREATE TABLE "match_player_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"map_id" uuid NOT NULL,
	"perfect_name" text NOT NULL,
	"user_id" uuid,
	"kills" integer,
	"deaths" integer,
	"assists" integer,
	"hs_percent" integer,
	"first_kills" integer,
	"multi_kills" integer,
	"clutches" integer,
	"adr" real,
	"rws" real,
	"rating_pro" real,
	"we" real,
	"verified_by_admin" text,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "match_player_stats" ADD CONSTRAINT "match_player_stats_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_player_stats" ADD CONSTRAINT "match_player_stats_map_id_match_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."match_maps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_player_stats" ADD CONSTRAINT "match_player_stats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_player_stats" ADD CONSTRAINT "match_player_stats_map_id_perfect_name_unique" UNIQUE("map_id","perfect_name");
