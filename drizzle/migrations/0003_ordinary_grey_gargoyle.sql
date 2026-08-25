CREATE TYPE "public"."major_prestart_issue_category" AS ENUM('qualification', 'administration');--> statement-breakpoint
CREATE TABLE "major_prestart_entrants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"roster_confirmed_at" timestamp with time zone,
	"roster_confirmed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "major_prestart_entrants_season_team_unique" UNIQUE("season_id","team_id")
);
--> statement-breakpoint
CREATE TABLE "major_prestart_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"category" "major_prestart_issue_category" NOT NULL,
	"label" text NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "major_prestart_roster_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entrant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "major_prestart_roster_members_entrant_user_unique" UNIQUE("entrant_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "major_prestart_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"entrants_locked_at" timestamp with time zone,
	"entrants_locked_by" text,
	"seed_revision" integer DEFAULT 0 NOT NULL,
	"confirmed_seed_revision" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "major_prestart_states_season_id_unique" UNIQUE("season_id")
);
--> statement-breakpoint
ALTER TABLE "major_prestart_entrants" ADD CONSTRAINT "major_prestart_entrants_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "major_prestart_entrants" ADD CONSTRAINT "major_prestart_entrants_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "major_prestart_issues" ADD CONSTRAINT "major_prestart_issues_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "major_prestart_roster_members" ADD CONSTRAINT "major_prestart_roster_members_entrant_id_major_prestart_entrants_id_fk" FOREIGN KEY ("entrant_id") REFERENCES "public"."major_prestart_entrants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "major_prestart_roster_members" ADD CONSTRAINT "major_prestart_roster_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "major_prestart_states" ADD CONSTRAINT "major_prestart_states_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "major_prestart_entrants_season_idx" ON "major_prestart_entrants" USING btree ("season_id");--> statement-breakpoint
CREATE INDEX "major_prestart_issues_season_category_idx" ON "major_prestart_issues" USING btree ("season_id","category");--> statement-breakpoint
CREATE INDEX "major_prestart_roster_members_entrant_idx" ON "major_prestart_roster_members" USING btree ("entrant_id");