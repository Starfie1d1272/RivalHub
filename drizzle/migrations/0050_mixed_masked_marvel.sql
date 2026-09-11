CREATE TYPE "public"."announcement_scope" AS ENUM('site', 'season');--> statement-breakpoint
CREATE TYPE "public"."announcement_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TYPE "public"."announcement_type" AS ENUM('notice', 'product_update', 'important_alert');--> statement-breakpoint
CREATE TYPE "public"."feedback_category" AS ENUM('problem', 'question', 'feature_suggestion', 'content_correction', 'other');--> statement-breakpoint
CREATE TYPE "public"."feedback_status" AS ENUM('new', 'triaged', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."community_group_status" AS ENUM('active', 'closed');--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" "announcement_scope" NOT NULL,
	"season_id" uuid,
	"type" "announcement_type" DEFAULT 'notice' NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"status" "announcement_status" DEFAULT 'draft' NOT NULL,
	"requires_attention" boolean DEFAULT false NOT NULL,
	"attention_until" timestamp with time zone,
	"published_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "announcements_scope_season_shape_check" CHECK (("announcements"."scope" = 'site' AND "announcements"."season_id" IS NULL) OR ("announcements"."scope" = 'season' AND "announcements"."season_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "feedback_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"season_id" uuid,
	"category" "feedback_category" NOT NULL,
	"body" text NOT NULL,
	"body_fingerprint" text NOT NULL,
	"pathname" text NOT NULL,
	"release_version" text NOT NULL,
	"status" "feedback_status" DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_reports_body_shape_check" CHECK (char_length("feedback_reports"."body") BETWEEN 1 AND 4000)
);
--> statement-breakpoint
CREATE TABLE "community_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"label" text NOT NULL,
	"audience" text,
	"group_number" text,
	"qr_image_path" text,
	"join_url" text,
	"note" text,
	"status" "community_group_status" DEFAULT 'active' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_groups_active_join_method_check" CHECK ("community_groups"."status" = 'closed' OR "community_groups"."qr_image_path" IS NOT NULL OR "community_groups"."group_number" IS NOT NULL OR "community_groups"."join_url" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "season_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"label" text NOT NULL,
	"public_name" text,
	"value" text NOT NULL,
	"href" text,
	"note" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "season_public_info" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"rules_label" text DEFAULT '赛事规则' NOT NULL,
	"rules_href" text DEFAULT '/rules' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "season_public_info_season_unique" UNIQUE("season_id")
);
--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new announcement table is empty at creation, so foreign-key validation scans no child rows
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new announcement table is empty at creation, so foreign-key validation scans no child rows
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new announcement table is empty at creation, so foreign-key validation scans no child rows
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new feedback table is empty at creation, so foreign-key validation scans no child rows
ALTER TABLE "feedback_reports" ADD CONSTRAINT "feedback_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new feedback table is empty at creation, so foreign-key validation scans no child rows
ALTER TABLE "feedback_reports" ADD CONSTRAINT "feedback_reports_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new community group table is empty at creation, so foreign-key validation scans no child rows
ALTER TABLE "community_groups" ADD CONSTRAINT "community_groups_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new season contact table is empty at creation, so foreign-key validation scans no child rows
ALTER TABLE "season_contacts" ADD CONSTRAINT "season_contacts_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new season public info table is empty at creation, so foreign-key validation scans no child rows
ALTER TABLE "season_public_info" ADD CONSTRAINT "season_public_info_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new announcement index is bounded to the empty table at creation
CREATE INDEX "announcements_season_status_published_at_idx" ON "announcements" USING btree ("season_id","status","published_at");--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new announcement index is bounded to the empty table at creation
CREATE INDEX "announcements_scope_status_published_at_idx" ON "announcements" USING btree ("scope","status","published_at");--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new feedback index is bounded to the empty table at creation
CREATE INDEX "feedback_reports_status_created_at_idx" ON "feedback_reports" USING btree ("status","created_at");--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new feedback index is bounded to the empty table at creation
CREATE INDEX "feedback_reports_user_created_at_idx" ON "feedback_reports" USING btree ("user_id","created_at");--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new feedback index is bounded to the empty table at creation
CREATE INDEX "feedback_reports_fingerprint_created_at_idx" ON "feedback_reports" USING btree ("body_fingerprint","created_at");--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new feedback index is bounded to the empty table at creation
CREATE INDEX "feedback_reports_season_created_at_idx" ON "feedback_reports" USING btree ("season_id","created_at");--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new community group index is bounded to the empty table at creation
CREATE INDEX "community_groups_season_sort_order_idx" ON "community_groups" USING btree ("season_id","sort_order","created_at");--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new season contact index is bounded to the empty table at creation
CREATE INDEX "season_contacts_season_sort_order_idx" ON "season_contacts" USING btree ("season_id","sort_order","created_at");
--> statement-breakpoint
-- Supabase Storage is optional during plain PostgreSQL replay. When present,
-- this migration remains the sole owner of the public QR asset bucket.
DO $$
DECLARE
  bucket_exists boolean;
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RETURN;
  END IF;

  EXECUTE 'SELECT EXISTS (SELECT 1 FROM storage.buckets WHERE id = $1 OR name = $1)'
    INTO bucket_exists
    USING 'season-public-assets';

  IF bucket_exists THEN
    EXECUTE 'UPDATE storage.buckets
      SET name = $1, public = true, file_size_limit = $2, allowed_mime_types = $3
      WHERE id = $1 OR name = $1'
      USING 'season-public-assets', 1048576, ARRAY['image/jpeg', 'image/png', 'image/webp']::text[];
  ELSE
    EXECUTE 'INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      VALUES ($1, $1, true, $2, $3)'
      USING 'season-public-assets', 1048576, ARRAY['image/jpeg', 'image/png', 'image/webp']::text[];
  END IF;
END $$;
