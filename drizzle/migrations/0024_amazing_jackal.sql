CREATE TYPE "public"."demo_side" AS ENUM('t', 'ct', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."stat_source" AS ENUM('manual_ocr', 'demo_import');--> statement-breakpoint
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
CREATE TABLE "registration_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"email" text NOT NULL,
	"payload" json DEFAULT '{}'::json NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registration_drafts_season_id_email_unique" UNIQUE("season_id","email")
);
--> statement-breakpoint
CREATE TABLE "match_mvp_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"player_user_id" uuid,
	"player_name" text NOT NULL,
	"voter_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_mvp_votes_match_id_voter_user_id_unique" UNIQUE("match_id","voter_user_id")
);
--> statement-breakpoint
CREATE TABLE "match_time_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"proposed_by" uuid NOT NULL,
	"force_assigned_by" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"proposed_time" timestamp with time zone NOT NULL,
	"response_at" timestamp with time zone,
	"reject_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "match_roster_players" (
	"roster_id" uuid NOT NULL,
	"team_member_id" uuid NOT NULL,
	"is_starter" boolean DEFAULT true NOT NULL,
	CONSTRAINT "match_roster_players_roster_id_team_member_id_unique" UNIQUE("roster_id","team_member_id")
);
--> statement-breakpoint
CREATE TABLE "match_rosters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"submitted_by" uuid NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"locked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_rosters_match_id_team_id_unique" UNIQUE("match_id","team_id")
);
--> statement-breakpoint
CREATE TABLE "match_veto_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"step_order" integer NOT NULL,
	"action_type" text NOT NULL,
	"map_name" text NOT NULL,
	"team_id" uuid,
	"side" "side",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_veto_steps_match_id_step_order_unique" UNIQUE("match_id","step_order")
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"last_active_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "match_player_stats" DROP CONSTRAINT "match_player_stats_map_id_perfect_name_unique";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_url" text;--> statement-breakpoint
ALTER TABLE "seasons" ADD COLUMN "team_registration_config" json DEFAULT '{}'::json NOT NULL;--> statement-breakpoint
ALTER TABLE "seasons" ADD COLUMN "min_team_size" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "seasons" ADD COLUMN "max_team_size" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "seasons" ADD COLUMN "stat_profile" json DEFAULT '{"provider":"perfectworld","inputFields":["kills","deaths","assists","hsPercent","firstKills","multiKills","clutches","adr","rws","ratingPro","we"],"rankMetric":"ratingPro"}'::json NOT NULL;--> statement-breakpoint
ALTER TABLE "seasons" ADD COLUMN "registration_deadline" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "season_registrations" ADD COLUMN "map_preferences" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "logo_url" text;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "entry_round" text;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "is_forfeit" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "completion_deadline" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "mvp_winner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "match_maps" ADD COLUMN "active_stat_source" "stat_source";--> statement-breakpoint
ALTER TABLE "match_player_stats" ADD COLUMN "source" "stat_source" DEFAULT 'manual_ocr' NOT NULL;--> statement-breakpoint
ALTER TABLE "demo_blinds" ADD CONSTRAINT "demo_blinds_import_batch_id_demo_imports_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."demo_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_blinds" ADD CONSTRAINT "demo_blinds_map_id_match_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."match_maps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_bombs" ADD CONSTRAINT "demo_bombs_import_batch_id_demo_imports_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."demo_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_bombs" ADD CONSTRAINT "demo_bombs_map_id_match_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."match_maps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_clutches" ADD CONSTRAINT "demo_clutches_import_batch_id_demo_imports_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."demo_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_clutches" ADD CONSTRAINT "demo_clutches_map_id_match_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."match_maps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_damages" ADD CONSTRAINT "demo_damages_import_batch_id_demo_imports_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."demo_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_damages" ADD CONSTRAINT "demo_damages_map_id_match_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."match_maps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_grenades" ADD CONSTRAINT "demo_grenades_import_batch_id_demo_imports_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."demo_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_grenades" ADD CONSTRAINT "demo_grenades_map_id_match_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."match_maps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_imports" ADD CONSTRAINT "demo_imports_map_id_match_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."match_maps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_imports" ADD CONSTRAINT "demo_imports_imported_by_users_id_fk" FOREIGN KEY ("imported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_kills" ADD CONSTRAINT "demo_kills_import_batch_id_demo_imports_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."demo_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_kills" ADD CONSTRAINT "demo_kills_map_id_match_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."match_maps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_player_economies" ADD CONSTRAINT "demo_player_economies_import_batch_id_demo_imports_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."demo_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_player_economies" ADD CONSTRAINT "demo_player_economies_map_id_match_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."match_maps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_player_stats" ADD CONSTRAINT "demo_player_stats_import_batch_id_demo_imports_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."demo_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_player_stats" ADD CONSTRAINT "demo_player_stats_map_id_match_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."match_maps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_player_stats" ADD CONSTRAINT "demo_player_stats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_players" ADD CONSTRAINT "demo_players_import_batch_id_demo_imports_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."demo_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_players" ADD CONSTRAINT "demo_players_map_id_match_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."match_maps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_players" ADD CONSTRAINT "demo_players_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_positions" ADD CONSTRAINT "demo_positions_import_batch_id_demo_imports_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."demo_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_positions" ADD CONSTRAINT "demo_positions_map_id_match_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."match_maps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_rounds" ADD CONSTRAINT "demo_rounds_import_batch_id_demo_imports_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."demo_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_rounds" ADD CONSTRAINT "demo_rounds_map_id_match_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."match_maps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_shots" ADD CONSTRAINT "demo_shots_import_batch_id_demo_imports_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."demo_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_shots" ADD CONSTRAINT "demo_shots_map_id_match_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."match_maps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_drafts" ADD CONSTRAINT "registration_drafts_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_mvp_votes" ADD CONSTRAINT "match_mvp_votes_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_mvp_votes" ADD CONSTRAINT "match_mvp_votes_player_user_id_users_id_fk" FOREIGN KEY ("player_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_mvp_votes" ADD CONSTRAINT "match_mvp_votes_voter_user_id_users_id_fk" FOREIGN KEY ("voter_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_time_proposals" ADD CONSTRAINT "match_time_proposals_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_time_proposals" ADD CONSTRAINT "match_time_proposals_proposed_by_users_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_time_proposals" ADD CONSTRAINT "match_time_proposals_force_assigned_by_users_id_fk" FOREIGN KEY ("force_assigned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_roster_players" ADD CONSTRAINT "match_roster_players_roster_id_match_rosters_id_fk" FOREIGN KEY ("roster_id") REFERENCES "public"."match_rosters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_roster_players" ADD CONSTRAINT "match_roster_players_team_member_id_team_members_id_fk" FOREIGN KEY ("team_member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_rosters" ADD CONSTRAINT "match_rosters_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_rosters" ADD CONSTRAINT "match_rosters_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_rosters" ADD CONSTRAINT "match_rosters_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_veto_steps" ADD CONSTRAINT "match_veto_steps_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_veto_steps" ADD CONSTRAINT "match_veto_steps_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "demo_blinds_import_batch_id_map_id_index" ON "demo_blinds" USING btree ("import_batch_id","map_id");--> statement-breakpoint
CREATE INDEX "demo_bombs_import_batch_id_map_id_index" ON "demo_bombs" USING btree ("import_batch_id","map_id");--> statement-breakpoint
CREATE INDEX "demo_clutches_import_batch_id_map_id_index" ON "demo_clutches" USING btree ("import_batch_id","map_id");--> statement-breakpoint
CREATE INDEX "demo_damages_import_batch_id_map_id_index" ON "demo_damages" USING btree ("import_batch_id","map_id");--> statement-breakpoint
CREATE INDEX "demo_grenades_import_batch_id_map_id_index" ON "demo_grenades" USING btree ("import_batch_id","map_id");--> statement-breakpoint
CREATE INDEX "demo_kills_import_batch_id_map_id_index" ON "demo_kills" USING btree ("import_batch_id","map_id");--> statement-breakpoint
CREATE INDEX "demo_player_economies_import_batch_id_map_id_index" ON "demo_player_economies" USING btree ("import_batch_id","map_id");--> statement-breakpoint
CREATE INDEX "demo_player_stats_import_batch_id_map_id_index" ON "demo_player_stats" USING btree ("import_batch_id","map_id");--> statement-breakpoint
CREATE INDEX "demo_players_import_batch_id_map_id_index" ON "demo_players" USING btree ("import_batch_id","map_id");--> statement-breakpoint
CREATE INDEX "demo_positions_import_batch_id_map_id_index" ON "demo_positions" USING btree ("import_batch_id","map_id");--> statement-breakpoint
CREATE INDEX "demo_rounds_import_batch_id_map_id_index" ON "demo_rounds" USING btree ("import_batch_id","map_id");--> statement-breakpoint
CREATE INDEX "demo_shots_import_batch_id_map_id_index" ON "demo_shots" USING btree ("import_batch_id","map_id");--> statement-breakpoint
ALTER TABLE "seasons" DROP COLUMN "team_size";--> statement-breakpoint
ALTER TABLE "match_player_stats" ADD CONSTRAINT "match_player_stats_map_id_perfect_name_source_unique" UNIQUE("map_id","perfect_name","source");