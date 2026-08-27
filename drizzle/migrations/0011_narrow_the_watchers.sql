CREATE TYPE "public"."adjudication_impact" AS ENUM('canonical_matches', 'final_result', 'official_placements', 'honors', 'none');--> statement-breakpoint
CREATE TYPE "public"."adjudication_kind" AS ENUM('team_sanction', 'result_statement', 'placement_statement', 'honor_directive');--> statement-breakpoint
CREATE TYPE "public"."adjudication_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."adjudication_target" AS ENUM('season', 'team', 'user', 'match');--> statement-breakpoint
CREATE TYPE "public"."honor_basis" AS ENUM('final_result', 'manual', 'adjudication');--> statement-breakpoint
CREATE TYPE "public"."honor_state" AS ENUM('valid', 'revoked', 'vacant', 'not_awarded');--> statement-breakpoint
CREATE TYPE "public"."honor_type" AS ENUM('champion', 'runner_up', 'placement', 'manual_award');--> statement-breakpoint
CREATE TABLE "post_event_adjudications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"client_request_id" uuid NOT NULL,
	"status" "adjudication_status" DEFAULT 'active' NOT NULL,
	"kind" "adjudication_kind" NOT NULL,
	"target" "adjudication_target" NOT NULL,
	"impacts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"target_team_id" uuid,
	"target_user_id" uuid,
	"target_match_id" uuid,
	"reason" text NOT NULL,
	"public_explanation" text NOT NULL,
	"internal_evidence" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_by" text,
	"revoked_at" timestamp with time zone,
	"revocation_reason" text,
	CONSTRAINT "post_event_adjudications_client_request_id_unique" UNIQUE("client_request_id"),
	CONSTRAINT "post_event_adjudications_target_check" CHECK (("post_event_adjudications"."target" = 'season' AND "post_event_adjudications"."target_team_id" IS NULL AND "post_event_adjudications"."target_user_id" IS NULL AND "post_event_adjudications"."target_match_id" IS NULL)
      OR ("post_event_adjudications"."target" = 'team' AND "post_event_adjudications"."target_team_id" IS NOT NULL AND "post_event_adjudications"."target_user_id" IS NULL AND "post_event_adjudications"."target_match_id" IS NULL)
      OR ("post_event_adjudications"."target" = 'user' AND "post_event_adjudications"."target_team_id" IS NULL AND "post_event_adjudications"."target_user_id" IS NOT NULL AND "post_event_adjudications"."target_match_id" IS NULL)
      OR ("post_event_adjudications"."target" = 'match' AND "post_event_adjudications"."target_team_id" IS NULL AND "post_event_adjudications"."target_user_id" IS NULL AND "post_event_adjudications"."target_match_id" IS NOT NULL)),
	CONSTRAINT "post_event_adjudications_revocation_check" CHECK (("post_event_adjudications"."status" = 'revoked') = ("post_event_adjudications"."revoked_at" IS NOT NULL)),
	CONSTRAINT "post_event_adjudications_impacts_array_check" CHECK (jsonb_typeof("post_event_adjudications"."impacts") = 'array')
);
--> statement-breakpoint
CREATE TABLE "tournament_honors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"client_request_id" uuid NOT NULL,
	"honor_key" text NOT NULL,
	"type" "honor_type" NOT NULL,
	"label" text NOT NULL,
	"state" "honor_state" DEFAULT 'valid' NOT NULL,
	"basis" "honor_basis" NOT NULL,
	"placement_from" integer,
	"placement_to" integer,
	"team_id" uuid,
	"user_id" uuid,
	"source_final_result_id" uuid,
	"adjudication_id" uuid,
	"awarded_by" text NOT NULL,
	"awarded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_by" text,
	"revoked_at" timestamp with time zone,
	"revocation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tournament_honors_client_request_id_unique" UNIQUE("client_request_id"),
	CONSTRAINT "tournament_honors_recipient_check" CHECK (("tournament_honors"."state" IN ('valid', 'revoked') AND (("tournament_honors"."team_id" IS NOT NULL)::int + ("tournament_honors"."user_id" IS NOT NULL)::int) = 1)
      OR ("tournament_honors"."state" IN ('vacant', 'not_awarded') AND "tournament_honors"."team_id" IS NULL AND "tournament_honors"."user_id" IS NULL)),
	CONSTRAINT "tournament_honors_placement_check" CHECK (("tournament_honors"."type" = 'placement' AND "tournament_honors"."placement_from" IS NOT NULL AND "tournament_honors"."placement_to" IS NOT NULL AND "tournament_honors"."placement_from" > 0 AND "tournament_honors"."placement_to" >= "tournament_honors"."placement_from")
      OR ("tournament_honors"."type" <> 'placement' AND "tournament_honors"."placement_from" IS NULL AND "tournament_honors"."placement_to" IS NULL)),
	CONSTRAINT "tournament_honors_revocation_check" CHECK (("tournament_honors"."state" = 'revoked') = ("tournament_honors"."revoked_at" IS NOT NULL)),
	CONSTRAINT "tournament_honors_non_blank_key_check" CHECK (length(trim("tournament_honors"."honor_key")) > 0)
);
--> statement-breakpoint
ALTER TABLE "post_event_adjudications" ADD CONSTRAINT "post_event_adjudications_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_event_adjudications" ADD CONSTRAINT "post_event_adjudications_target_team_id_teams_id_fk" FOREIGN KEY ("target_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_event_adjudications" ADD CONSTRAINT "post_event_adjudications_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_event_adjudications" ADD CONSTRAINT "post_event_adjudications_target_match_id_matches_id_fk" FOREIGN KEY ("target_match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_honors" ADD CONSTRAINT "tournament_honors_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_honors" ADD CONSTRAINT "tournament_honors_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_honors" ADD CONSTRAINT "tournament_honors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_honors" ADD CONSTRAINT "tournament_honors_source_final_result_id_major_final_results_id_fk" FOREIGN KEY ("source_final_result_id") REFERENCES "public"."major_final_results"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_honors" ADD CONSTRAINT "tournament_honors_adjudication_id_post_event_adjudications_id_fk" FOREIGN KEY ("adjudication_id") REFERENCES "public"."post_event_adjudications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "post_event_adjudications_season_idx" ON "post_event_adjudications" USING btree ("season_id");--> statement-breakpoint
CREATE INDEX "tournament_honors_season_idx" ON "tournament_honors" USING btree ("season_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tournament_honors_one_valid_slot_unique" ON "tournament_honors" USING btree ("season_id","honor_key") WHERE "tournament_honors"."state" = 'valid';
--> statement-breakpoint
ALTER TABLE post_event_adjudications ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_honors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON post_event_adjudications, tournament_honors FROM anon, authenticated;
