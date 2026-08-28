CREATE TYPE "public"."admin_role" AS ENUM('super_admin', 'admin');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'season_admin', 'super_admin');--> statement-breakpoint
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
ALTER TABLE "seasons" ALTER COLUMN "kind" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "season_registrations" ALTER COLUMN "primary_position" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "season_registrations" ALTER COLUMN "secondary_position" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "season_registrations" ALTER COLUMN "secondary_position" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "season_registrations" ALTER COLUMN "peak_rating" SET DATA TYPE real;--> statement-breakpoint
ALTER TABLE "season_registrations" ALTER COLUMN "peak_rating" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role" "user_role" DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "admin_season_id" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "student_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "perfect_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "steam_name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "steam_profile_url" text;--> statement-breakpoint
ALTER TABLE "seasons" ADD COLUMN "positions" text[] DEFAULT ARRAY['igl','awper','opener','closer','anchor'] NOT NULL;--> statement-breakpoint
ALTER TABLE "seasons" ADD COLUMN "bracket_data" json;--> statement-breakpoint
ALTER TABLE "season_registrations" ADD COLUMN "peak_rank" text NOT NULL;--> statement-breakpoint
ALTER TABLE "season_registrations" ADD COLUMN "peak_rank_season" text NOT NULL;--> statement-breakpoint
ALTER TABLE "season_registrations" ADD COLUMN "peak_we" real;--> statement-breakpoint
ALTER TABLE "season_registrations" ADD COLUMN "current_season_peak_rank" text NOT NULL;--> statement-breakpoint
ALTER TABLE "season_registrations" ADD COLUMN "current_rating" real NOT NULL;--> statement-breakpoint
ALTER TABLE "season_registrations" ADD COLUMN "current_we" real;--> statement-breakpoint
ALTER TABLE "season_registrations" ADD COLUMN "screenshot_urls" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "season_registrations" ADD COLUMN "gameplay_style" text NOT NULL;--> statement-breakpoint
ALTER TABLE "season_registrations" ADD COLUMN "competition_history" text;--> statement-breakpoint
ALTER TABLE "season_registrations" ADD COLUMN "highlight_video_url" text;--> statement-breakpoint
ALTER TABLE "admin_invites" ADD CONSTRAINT "admin_invites_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_registrations" DROP COLUMN "screenshot_url";--> statement-breakpoint
DROP TYPE "public"."season_kind";--> statement-breakpoint
DROP TYPE "public"."position";