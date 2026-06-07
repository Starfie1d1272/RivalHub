CREATE TYPE "public"."analysis_run_status" AS ENUM('processing', 'ready', 'failed', 'superseded');--> statement-breakpoint
CREATE TABLE "demo_analysis_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid NOT NULL,
	"status" "analysis_run_status" DEFAULT 'processing' NOT NULL,
	"analysis_version" text NOT NULL,
	"rating_version" text,
	"analysis_bundle" jsonb,
	"workspace_model" jsonb,
	"qa_report" jsonb,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "season_analysis_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"status" "analysis_run_status" DEFAULT 'processing' NOT NULL,
	"cohort_version" text NOT NULL,
	"rating_version" text,
	"source_fingerprint" text NOT NULL,
	"cohort_bundle" jsonb,
	"leaderboard_model" jsonb,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_steam_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"steam_id64" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_steam_aliases_steam_id64_unique" UNIQUE("steam_id64")
);
--> statement-breakpoint
ALTER TABLE "demo_imports" ADD COLUMN "zip_object_path" text;--> statement-breakpoint
ALTER TABLE "demo_imports" ADD COLUMN "zip_byte_size" integer;--> statement-breakpoint
ALTER TABLE "demo_imports" ADD COLUMN "manifest" jsonb;--> statement-breakpoint
ALTER TABLE "demo_imports" ADD COLUMN "supersedes_import_id" uuid;--> statement-breakpoint
ALTER TABLE "demo_imports" ADD COLUMN "is_current" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "demo_analysis_runs" ADD CONSTRAINT "demo_analysis_runs_import_id_demo_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."demo_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_analysis_runs" ADD CONSTRAINT "season_analysis_runs_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_steam_aliases" ADD CONSTRAINT "user_steam_aliases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "demo_analysis_runs_import_status_idx" ON "demo_analysis_runs" USING btree ("import_id","status");--> statement-breakpoint
CREATE INDEX "season_analysis_runs_season_status_idx" ON "season_analysis_runs" USING btree ("season_id","status");--> statement-breakpoint
CREATE INDEX "demo_imports_map_current_idx" ON "demo_imports" USING btree ("map_id","is_current");--> statement-breakpoint
CREATE INDEX "demo_imports_hash_idx" ON "demo_imports" USING btree ("demo_hash");