CREATE TYPE "public"."demo_side" AS ENUM('t', 'ct', 'unknown');--> statement-breakpoint
CREATE TABLE "demo_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"map_id" uuid NOT NULL,
	"demo_hash" text NOT NULL,
	"schema_version" text NOT NULL,
	"exporter_name" text,
	"exporter_version" text,
	"parser_name" text,
	"map_name" text NOT NULL,
	"tickrate" integer NOT NULL,
	"exported_at" timestamp with time zone,
	"imported_by" uuid,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "demo_players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_batch_id" uuid NOT NULL,
	"map_id" uuid NOT NULL,
	"steam_id64" text NOT NULL,
	"name" text NOT NULL,
	"team_key" text NOT NULL,
	"user_id" uuid
);
--> statement-breakpoint
CREATE TABLE "demo_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_batch_id" uuid NOT NULL,
	"map_id" uuid NOT NULL,
	"round_number" integer NOT NULL,
	"start_tick" integer,
	"freeze_end_tick" integer,
	"end_tick" integer,
	"team_a_side" "demo_side",
	"team_b_side" "demo_side",
	"team_a_score_before" integer,
	"team_b_score_before" integer,
	"team_a_economy" text,
	"team_b_economy" text,
	"winner_team_key" text,
	"winner_side" "demo_side",
	"end_reason" text
);
--> statement-breakpoint
CREATE TABLE "demo_player_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_batch_id" uuid NOT NULL,
	"map_id" uuid NOT NULL,
	"steam_id64" text NOT NULL,
	"user_id" uuid,
	"team_key" text NOT NULL,
	"kills" integer,
	"deaths" integer,
	"assists" integer,
	"damage_health" integer,
	"damage_armor" integer,
	"adr" real,
	"utility_damage" integer,
	"avg_utility_damage_per_round" real,
	"headshot_count" integer,
	"first_kill_count" integer,
	"first_death_count" integer,
	"trade_kill_count" integer,
	"trade_death_count" integer,
	"kast" real,
	"one_kill_count" integer,
	"two_kill_count" integer,
	"three_kill_count" integer,
	"four_kill_count" integer,
	"five_kill_count" integer,
	"vs_one_count" integer,
	"vs_one_won_count" integer,
	"vs_one_lost_count" integer,
	"vs_two_count" integer,
	"vs_two_won_count" integer,
	"vs_two_lost_count" integer,
	"vs_three_count" integer,
	"vs_three_won_count" integer,
	"vs_three_lost_count" integer,
	"vs_four_count" integer,
	"vs_four_won_count" integer,
	"vs_four_lost_count" integer,
	"vs_five_count" integer,
	"vs_five_won_count" integer,
	"vs_five_lost_count" integer,
	"bomb_planted_count" integer,
	"bomb_defused_count" integer,
	"wallbang_kill_count" integer,
	"no_scope_kill_count" integer,
	"collateral_kill_count" integer
);
--> statement-breakpoint
CREATE TABLE "demo_player_economies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_batch_id" uuid NOT NULL,
	"map_id" uuid NOT NULL,
	"round_number" integer NOT NULL,
	"steam_id64" text NOT NULL,
	"team_key" text,
	"side" "demo_side",
	"start_money" integer,
	"money_spent" integer,
	"equipment_value" integer,
	"type" text
);
--> statement-breakpoint
CREATE TABLE "demo_kills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_batch_id" uuid NOT NULL,
	"map_id" uuid NOT NULL,
	"round_number" integer NOT NULL,
	"tick" integer NOT NULL,
	"killer_steam_id64" text,
	"victim_steam_id64" text,
	"assister_steam_id64" text,
	"killer_team_key" text,
	"victim_team_key" text,
	"killer_side" "demo_side",
	"victim_side" "demo_side",
	"weapon" text,
	"headshot" boolean,
	"flash_assist" boolean,
	"trade_kill" boolean,
	"trade_death" boolean,
	"through_smoke" boolean,
	"no_scope" boolean,
	"penetrated_objects" integer,
	"killer_position" json,
	"victim_position" json
);
--> statement-breakpoint
CREATE TABLE "demo_damages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_batch_id" uuid NOT NULL,
	"map_id" uuid NOT NULL,
	"round_number" integer NOT NULL,
	"tick" integer NOT NULL,
	"attacker_steam_id64" text,
	"victim_steam_id64" text,
	"attacker_team_key" text,
	"victim_team_key" text,
	"attacker_side" "demo_side",
	"victim_side" "demo_side",
	"weapon" text,
	"hitgroup" text,
	"health_damage" integer,
	"armor_damage" integer,
	"victim_health_before" integer,
	"victim_health_after" integer,
	"victim_armor_before" integer,
	"victim_armor_after" integer
);
--> statement-breakpoint
CREATE TABLE "demo_blinds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_batch_id" uuid NOT NULL,
	"map_id" uuid NOT NULL,
	"round_number" integer NOT NULL,
	"tick" integer NOT NULL,
	"flasher_steam_id64" text,
	"flashed_steam_id64" text,
	"flasher_team_key" text,
	"flashed_team_key" text,
	"flasher_side" "demo_side",
	"flashed_side" "demo_side",
	"duration_seconds" real
);
--> statement-breakpoint
CREATE TABLE "demo_bombs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_batch_id" uuid NOT NULL,
	"map_id" uuid NOT NULL,
	"round_number" integer NOT NULL,
	"tick" integer NOT NULL,
	"type" text,
	"site" text,
	"actor_steam_id64" text,
	"actor_team_key" text,
	"actor_side" "demo_side",
	"position" json
);
--> statement-breakpoint
CREATE TABLE "demo_clutches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_batch_id" uuid NOT NULL,
	"map_id" uuid NOT NULL,
	"round_number" integer NOT NULL,
	"tick" integer,
	"clutcher_steam_id64" text,
	"clutcher_team_key" text,
	"clutcher_side" "demo_side",
	"opponent_count" integer,
	"won" boolean,
	"survived" boolean,
	"kill_count" integer
);
--> statement-breakpoint
CREATE TABLE "demo_grenades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_batch_id" uuid NOT NULL,
	"map_id" uuid NOT NULL,
	"round_number" integer NOT NULL,
	"throw_tick" integer,
	"effect_tick" integer,
	"grenade" text,
	"thrower_steam_id64" text,
	"thrower_team_key" text,
	"thrower_side" "demo_side",
	"throw_position" json,
	"effect_position" json
);
--> statement-breakpoint
CREATE TABLE "demo_shots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_batch_id" uuid NOT NULL,
	"map_id" uuid NOT NULL,
	"round_number" integer NOT NULL,
	"tick" integer NOT NULL,
	"steam_id64" text,
	"team_key" text,
	"side" "demo_side",
	"weapon" text,
	"position" json,
	"velocity" json,
	"yaw" real,
	"pitch" real
);
--> statement-breakpoint
CREATE TABLE "demo_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_batch_id" uuid NOT NULL,
	"map_id" uuid NOT NULL,
	"round_number" integer NOT NULL,
	"tick" integer NOT NULL,
	"steam_id64" text NOT NULL,
	"team_key" text,
	"side" "demo_side",
	"alive" boolean,
	"position" json,
	"yaw" real,
	"pitch" real,
	"health" integer,
	"armor" integer,
	"money" integer,
	"active_weapon" text,
	"flash_duration_remaining" real,
	"has_bomb" boolean,
	"has_defuse_kit" boolean
);
--> statement-breakpoint
ALTER TABLE "demo_imports" ADD CONSTRAINT "demo_imports_map_id_match_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."match_maps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_imports" ADD CONSTRAINT "demo_imports_imported_by_users_id_fk" FOREIGN KEY ("imported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_players" ADD CONSTRAINT "demo_players_import_batch_id_demo_imports_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."demo_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_players" ADD CONSTRAINT "demo_players_map_id_match_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."match_maps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_players" ADD CONSTRAINT "demo_players_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_rounds" ADD CONSTRAINT "demo_rounds_import_batch_id_demo_imports_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."demo_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_rounds" ADD CONSTRAINT "demo_rounds_map_id_match_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."match_maps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_player_stats" ADD CONSTRAINT "demo_player_stats_import_batch_id_demo_imports_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."demo_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_player_stats" ADD CONSTRAINT "demo_player_stats_map_id_match_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."match_maps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_player_stats" ADD CONSTRAINT "demo_player_stats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_player_economies" ADD CONSTRAINT "demo_player_economies_import_batch_id_demo_imports_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."demo_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_player_economies" ADD CONSTRAINT "demo_player_economies_map_id_match_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."match_maps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_kills" ADD CONSTRAINT "demo_kills_import_batch_id_demo_imports_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."demo_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_kills" ADD CONSTRAINT "demo_kills_map_id_match_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."match_maps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_damages" ADD CONSTRAINT "demo_damages_import_batch_id_demo_imports_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."demo_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_damages" ADD CONSTRAINT "demo_damages_map_id_match_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."match_maps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_blinds" ADD CONSTRAINT "demo_blinds_import_batch_id_demo_imports_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."demo_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_blinds" ADD CONSTRAINT "demo_blinds_map_id_match_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."match_maps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_bombs" ADD CONSTRAINT "demo_bombs_import_batch_id_demo_imports_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."demo_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_bombs" ADD CONSTRAINT "demo_bombs_map_id_match_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."match_maps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_clutches" ADD CONSTRAINT "demo_clutches_import_batch_id_demo_imports_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."demo_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_clutches" ADD CONSTRAINT "demo_clutches_map_id_match_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."match_maps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_grenades" ADD CONSTRAINT "demo_grenades_import_batch_id_demo_imports_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."demo_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_grenades" ADD CONSTRAINT "demo_grenades_map_id_match_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."match_maps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_shots" ADD CONSTRAINT "demo_shots_import_batch_id_demo_imports_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."demo_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_shots" ADD CONSTRAINT "demo_shots_map_id_match_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."match_maps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_positions" ADD CONSTRAINT "demo_positions_import_batch_id_demo_imports_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."demo_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_positions" ADD CONSTRAINT "demo_positions_map_id_match_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."match_maps"("id") ON DELETE no action ON UPDATE no action;
