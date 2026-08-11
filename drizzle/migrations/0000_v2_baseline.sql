CREATE TYPE "public"."admin_role" AS ENUM('super_admin', 'admin');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'season_admin', 'super_admin');--> statement-breakpoint
CREATE TYPE "public"."registration_mode" AS ENUM('solo', 'team');--> statement-breakpoint
CREATE TYPE "public"."season_status" AS ENUM('draft', 'registration', 'voting', 'drafting', 'playing', 'finished', 'archived');--> statement-breakpoint
CREATE TYPE "public"."registration_status" AS ENUM('pending', 'approved', 'rejected', 'waitlisted');--> statement-breakpoint
CREATE TYPE "public"."match_format" AS ENUM('bo1', 'bo3', 'bo5');--> statement-breakpoint
CREATE TYPE "public"."match_status" AS ENUM('scheduled', 'in_progress', 'finished', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."side" AS ENUM('t', 'ct');--> statement-breakpoint
CREATE TABLE "admin_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"created_by" text NOT NULL,
	"role" "admin_role" DEFAULT 'admin' NOT NULL,
	"season_id" uuid,
	"max_uses" integer DEFAULT 1 NOT NULL,
	"used_count" integer DEFAULT 0 NOT NULL,
	"used_by_usernames" text[] DEFAULT '{}'::text[] NOT NULL,
	"expires_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_invites_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "admin_role" DEFAULT 'admin' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid,
	"action" text NOT NULL,
	"actor_id" text,
	"target_id" text,
	"target_type" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "draft_picks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"registration_id" uuid NOT NULL,
	"round" integer NOT NULL,
	"pick_number" integer NOT NULL,
	"auto_picked" boolean DEFAULT false NOT NULL,
	"client_request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "draft_picks_client_request_id_unique" UNIQUE("client_request_id"),
	CONSTRAINT "draft_picks_season_id_registration_id_unique" UNIQUE("season_id","registration_id")
);
--> statement-breakpoint
CREATE TABLE "draft_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"current_round" integer DEFAULT 1 NOT NULL,
	"current_team_id" uuid,
	"round_deadline" timestamp with time zone,
	"is_active" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "draft_state_season_id_unique" UNIQUE("season_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_id" uuid,
	"email" text NOT NULL,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"admin_season_id" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"student_id" text,
	"qq" text,
	"perfect_name" text,
	"display_name" text,
	"steam_name" text,
	"steam64" text,
	"steam_profile_url" text,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_auth_id_unique" UNIQUE("auth_id"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"status" "season_status" DEFAULT 'draft' NOT NULL,
	"theme_color" text,
	"registration_mode" "registration_mode" DEFAULT 'solo' NOT NULL,
	"has_captain_voting" boolean DEFAULT true NOT NULL,
	"has_draft" boolean DEFAULT true NOT NULL,
	"stage_plan" json DEFAULT '[]'::json NOT NULL,
	"registration_config" json DEFAULT '{}'::json NOT NULL,
	"team_registration_config" json DEFAULT '{}'::json NOT NULL,
	"min_team_size" integer DEFAULT 5 NOT NULL,
	"max_team_size" integer DEFAULT 7 NOT NULL,
	"starter_count" integer DEFAULT 5 NOT NULL,
	"positions" text[] DEFAULT ARRAY['igl','awper','opener','closer','anchor'] NOT NULL,
	"bracket_data" json,
	"start_at" timestamp with time zone,
	"registration_deadline" timestamp with time zone,
	"end_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seasons_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "season_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"player_type" text DEFAULT 'enrolled' NOT NULL,
	"primary_position" text NOT NULL,
	"secondary_position" text NOT NULL,
	"peak_rank" text NOT NULL,
	"peak_rank_season" text NOT NULL,
	"peak_rating" real NOT NULL,
	"peak_we" real,
	"current_season_peak_rank" text NOT NULL,
	"current_rating" real NOT NULL,
	"current_we" real,
	"screenshot_urls" text[] DEFAULT '{}'::text[] NOT NULL,
	"map_preferences" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"gameplay_style" text NOT NULL,
	"competition_history" text,
	"highlight_video_url" text,
	"status" "registration_status" DEFAULT 'pending' NOT NULL,
	"willing_to_be_captain" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "season_registrations_user_id_season_id_unique" UNIQUE("user_id","season_id")
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
CREATE TABLE "team_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"registration_id" uuid NOT NULL,
	"is_starter" boolean DEFAULT false NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_members_registration_id_unique" UNIQUE("registration_id")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"name" text NOT NULL,
	"logo_url" text,
	"captain_registration_id" uuid NOT NULL,
	"draft_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_season_id_draft_order_unique" UNIQUE("season_id","draft_order")
);
--> statement-breakpoint
CREATE TABLE "captain_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"voter_registration_id" uuid NOT NULL,
	"candidate_registration_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "captain_votes_voter_registration_id_candidate_registration_id_unique" UNIQUE("voter_registration_id","candidate_registration_id")
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"team_a_id" uuid NOT NULL,
	"team_b_id" uuid NOT NULL,
	"stage" text NOT NULL,
	"round" integer,
	"format" "match_format" DEFAULT 'bo1' NOT NULL,
	"entry_round" text,
	"score_a" integer,
	"score_b" integer,
	"status" "match_status" DEFAULT 'scheduled' NOT NULL,
	"is_forfeit" boolean DEFAULT false NOT NULL,
	"bracket_node_id" text,
	"scheduled_at" timestamp with time zone,
	"completion_deadline" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"mvp_winner_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matches_teams_different" CHECK ("matches"."team_a_id" != "matches"."team_b_id"),
	CONSTRAINT "matches_score_a_nonneg" CHECK ("matches"."score_a" IS NULL OR "matches"."score_a" >= 0),
	CONSTRAINT "matches_score_b_nonneg" CHECK ("matches"."score_b" IS NULL OR "matches"."score_b" >= 0)
);
--> statement-breakpoint
CREATE TABLE "match_maps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"map_order" integer NOT NULL,
	"map_name" text NOT NULL,
	"picked_by_team_id" uuid,
	"team_a_start_side" "side",
	"score_a" integer,
	"score_b" integer,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_maps_match_id_map_order_unique" UNIQUE("match_id","map_order"),
	CONSTRAINT "match_maps_order_range" CHECK ("match_maps"."map_order" >= 1 AND "match_maps"."map_order" <= 5),
	CONSTRAINT "match_maps_score_a_nonneg" CHECK ("match_maps"."score_a" IS NULL OR "match_maps"."score_a" >= 0),
	CONSTRAINT "match_maps_score_b_nonneg" CHECK ("match_maps"."score_b" IS NULL OR "match_maps"."score_b" >= 0)
);
--> statement-breakpoint
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
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_player_stats_map_id_perfect_name_unique" UNIQUE("map_id","perfect_name")
);
--> statement-breakpoint
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
ALTER TABLE "admin_invites" ADD CONSTRAINT "admin_invites_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_picks" ADD CONSTRAINT "draft_picks_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_picks" ADD CONSTRAINT "draft_picks_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_picks" ADD CONSTRAINT "draft_picks_registration_id_season_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."season_registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_state" ADD CONSTRAINT "draft_state_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_state" ADD CONSTRAINT "draft_state_current_team_id_teams_id_fk" FOREIGN KEY ("current_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_registrations" ADD CONSTRAINT "season_registrations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_registrations" ADD CONSTRAINT "season_registrations_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_drafts" ADD CONSTRAINT "registration_drafts_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_registration_id_season_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."season_registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_captain_registration_id_season_registrations_id_fk" FOREIGN KEY ("captain_registration_id") REFERENCES "public"."season_registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captain_votes" ADD CONSTRAINT "captain_votes_voter_registration_id_season_registrations_id_fk" FOREIGN KEY ("voter_registration_id") REFERENCES "public"."season_registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captain_votes" ADD CONSTRAINT "captain_votes_candidate_registration_id_season_registrations_id_fk" FOREIGN KEY ("candidate_registration_id") REFERENCES "public"."season_registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_team_a_id_teams_id_fk" FOREIGN KEY ("team_a_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_team_b_id_teams_id_fk" FOREIGN KEY ("team_b_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_maps" ADD CONSTRAINT "match_maps_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_maps" ADD CONSTRAINT "match_maps_picked_by_team_id_teams_id_fk" FOREIGN KEY ("picked_by_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_player_stats" ADD CONSTRAINT "match_player_stats_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_player_stats" ADD CONSTRAINT "match_player_stats_map_id_match_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."match_maps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_player_stats" ADD CONSTRAINT "match_player_stats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swiss_standings" ADD CONSTRAINT "swiss_standings_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swiss_standings" ADD CONSTRAINT "swiss_standings_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;