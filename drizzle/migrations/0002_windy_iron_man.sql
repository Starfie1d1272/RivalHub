CREATE TYPE "public"."team_application_member_status" AS ENUM('invited', 'confirmed');--> statement-breakpoint
CREATE TYPE "public"."team_application_status" AS ENUM('draft', 'submitted', 'approved', 'waitlisted', 'rejected');--> statement-breakpoint
CREATE TABLE "team_application_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "team_application_member_status" DEFAULT 'invited' NOT NULL,
	"invited_by_user_id" uuid NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_application_members_application_user_unique" UNIQUE("application_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "team_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"name" text NOT NULL,
	"logo_url" text,
	"captain_user_id" uuid NOT NULL,
	"status" "team_application_status" DEFAULT 'draft' NOT NULL,
	"submitted_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" text,
	"review_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "team_members" ALTER COLUMN "registration_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ALTER COLUMN "captain_registration_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ALTER COLUMN "draft_order" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "team_members" ADD COLUMN "team_application_member_id" uuid;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "team_application_id" uuid;--> statement-breakpoint
ALTER TABLE "team_application_members" ADD CONSTRAINT "team_application_members_application_id_team_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."team_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_application_members" ADD CONSTRAINT "team_application_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_application_members" ADD CONSTRAINT "team_application_members_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_applications" ADD CONSTRAINT "team_applications_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_applications" ADD CONSTRAINT "team_applications_captain_user_id_users_id_fk" FOREIGN KEY ("captain_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "team_application_members_user_status_idx" ON "team_application_members" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "team_applications_season_status_idx" ON "team_applications" USING btree ("season_id","status");--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_application_member_id_team_application_members_id_fk" FOREIGN KEY ("team_application_member_id") REFERENCES "public"."team_application_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_team_application_id_team_applications_id_fk" FOREIGN KEY ("team_application_id") REFERENCES "public"."team_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_application_member_id_unique" UNIQUE("team_application_member_id");--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_team_application_id_unique" UNIQUE("team_application_id");
--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_source_provenance_check" CHECK (("captain_registration_id" IS NOT NULL AND "team_application_id" IS NULL) OR ("captain_registration_id" IS NULL AND "team_application_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_source_provenance_check" CHECK (("registration_id" IS NOT NULL AND "team_application_member_id" IS NULL) OR ("registration_id" IS NULL AND "team_application_member_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "team_applications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "team_application_members" ENABLE ROW LEVEL SECURITY;
