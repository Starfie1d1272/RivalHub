CREATE TYPE "public"."playoff_format" AS ENUM('double_elim', 'single_elim');--> statement-breakpoint
CREATE TYPE "public"."qualifier_format" AS ENUM('round_robin', 'swiss');--> statement-breakpoint
CREATE TYPE "public"."registration_mode" AS ENUM('solo', 'team');--> statement-breakpoint
CREATE TYPE "public"."season_kind" AS ENUM('rivals', 'major');--> statement-breakpoint
CREATE TYPE "public"."season_status" AS ENUM('draft', 'registration', 'voting', 'drafting', 'playing', 'finished', 'archived');--> statement-breakpoint
CREATE TYPE "public"."position" AS ENUM('entry', 'awper', 'support', 'lurker', 'igl');--> statement-breakpoint
CREATE TYPE "public"."registration_status" AS ENUM('pending', 'approved', 'rejected', 'waitlisted');--> statement-breakpoint
CREATE TYPE "public"."match_format" AS ENUM('bo1', 'bo3', 'bo5');--> statement-breakpoint
CREATE TYPE "public"."match_stage" AS ENUM('qualifier', 'playoff');--> statement-breakpoint
CREATE TYPE "public"."match_status" AS ENUM('scheduled', 'in_progress', 'finished', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."side" AS ENUM('t', 'ct');--> statement-breakpoint
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
	CONSTRAINT "draft_picks_client_request_id_unique" UNIQUE("client_request_id")
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
	"steam64" text,
	"qq" text,
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
	"kind" "season_kind" NOT NULL,
	"status" "season_status" DEFAULT 'draft' NOT NULL,
	"theme_color" text,
	"registration_mode" "registration_mode" DEFAULT 'solo' NOT NULL,
	"has_captain_voting" boolean DEFAULT true NOT NULL,
	"has_draft" boolean DEFAULT true NOT NULL,
	"qualifier_format" "qualifier_format" DEFAULT 'round_robin',
	"playoff_format" "playoff_format" DEFAULT 'double_elim',
	"team_size" integer DEFAULT 7 NOT NULL,
	"starter_count" integer DEFAULT 5 NOT NULL,
	"start_at" timestamp with time zone,
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
	"primary_position" "position" NOT NULL,
	"secondary_position" "position",
	"peak_rating" integer,
	"screenshot_url" text,
	"status" "registration_status" DEFAULT 'pending' NOT NULL,
	"willing_to_be_captain" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "season_registrations_user_id_season_id_unique" UNIQUE("user_id","season_id")
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"registration_id" uuid NOT NULL,
	"is_starter" boolean DEFAULT false NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"name" text NOT NULL,
	"captain_registration_id" uuid NOT NULL,
	"draft_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
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
	"stage" "match_stage" NOT NULL,
	"format" "match_format" DEFAULT 'bo1' NOT NULL,
	"score_a" integer,
	"score_b" integer,
	"status" "match_status" DEFAULT 'scheduled' NOT NULL,
	"bracket_node_id" text,
	"scheduled_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
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
	CONSTRAINT "match_maps_match_id_map_order_unique" UNIQUE("match_id","map_order")
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_picks" ADD CONSTRAINT "draft_picks_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_picks" ADD CONSTRAINT "draft_picks_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_picks" ADD CONSTRAINT "draft_picks_registration_id_season_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."season_registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_state" ADD CONSTRAINT "draft_state_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_state" ADD CONSTRAINT "draft_state_current_team_id_teams_id_fk" FOREIGN KEY ("current_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_registrations" ADD CONSTRAINT "season_registrations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_registrations" ADD CONSTRAINT "season_registrations_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "match_maps" ADD CONSTRAINT "match_maps_picked_by_team_id_teams_id_fk" FOREIGN KEY ("picked_by_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;