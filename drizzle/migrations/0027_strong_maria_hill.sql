CREATE TYPE "public"."community_award_status" AS ENUM('pending_review', 'rejected', 'approved', 'withdrawn', 'awarded', 'not_awarded', 'cancelled');--> statement-breakpoint
CREATE TABLE "community_award_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"award_id" uuid NOT NULL,
	"submitted_by_user_id" uuid NOT NULL,
	"candidate_user_id" uuid,
	"match_id" uuid,
	"explanation" text NOT NULL,
	"video_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_award_evidence_non_blank_explanation_check" CHECK (length(trim("community_award_evidence"."explanation")) > 0)
);
--> statement-breakpoint
CREATE TABLE "community_awards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"submitted_by_user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"condition" text NOT NULL,
	"prize" text NOT NULL,
	"supplementary_note" text,
	"public_note" text,
	"status" "community_award_status" DEFAULT 'pending_review' NOT NULL,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"recipient_user_id" uuid,
	"outcome_note" text,
	"outcome_by_user_id" uuid,
	"outcome_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_awards_non_blank_fields_check" CHECK (length(trim("community_awards"."name")) > 0 AND length(trim("community_awards"."condition")) > 0 AND length(trim("community_awards"."prize")) > 0),
	CONSTRAINT "community_awards_review_check" CHECK (("community_awards"."status" = 'pending_review' AND (("community_awards"."reviewed_by_user_id" IS NULL AND "community_awards"."reviewed_at" IS NULL) OR ("community_awards"."reviewed_by_user_id" IS NOT NULL AND "community_awards"."reviewed_at" IS NOT NULL)))
      OR ("community_awards"."status" IN ('rejected', 'approved', 'awarded', 'not_awarded', 'cancelled') AND "community_awards"."reviewed_by_user_id" IS NOT NULL AND "community_awards"."reviewed_at" IS NOT NULL)
      OR ("community_awards"."status" = 'withdrawn')),
	CONSTRAINT "community_awards_outcome_check" CHECK (("community_awards"."status" = 'awarded' AND "community_awards"."recipient_user_id" IS NOT NULL AND "community_awards"."outcome_by_user_id" IS NOT NULL AND "community_awards"."outcome_at" IS NOT NULL)
      OR ("community_awards"."status" IN ('not_awarded', 'cancelled', 'withdrawn') AND "community_awards"."recipient_user_id" IS NULL AND "community_awards"."outcome_by_user_id" IS NOT NULL AND "community_awards"."outcome_at" IS NOT NULL)
      OR ("community_awards"."status" IN ('pending_review', 'rejected', 'approved') AND "community_awards"."recipient_user_id" IS NULL AND "community_awards"."outcome_by_user_id" IS NULL AND "community_awards"."outcome_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "match_commentators" (
	"match_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"added_by_user_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_commentators_match_id_user_id_pk" PRIMARY KEY("match_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "post_match_reports" (
	"match_id" uuid PRIMARY KEY NOT NULL,
	"submitted_by_user_id" uuid NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "live_stream_url" text;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "video_url" text;--> statement-breakpoint
ALTER TABLE "community_award_evidence" ADD CONSTRAINT "community_award_evidence_award_id_community_awards_id_fk" FOREIGN KEY ("award_id") REFERENCES "public"."community_awards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_award_evidence" ADD CONSTRAINT "community_award_evidence_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_award_evidence" ADD CONSTRAINT "community_award_evidence_candidate_user_id_users_id_fk" FOREIGN KEY ("candidate_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_award_evidence" ADD CONSTRAINT "community_award_evidence_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_awards" ADD CONSTRAINT "community_awards_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_awards" ADD CONSTRAINT "community_awards_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_awards" ADD CONSTRAINT "community_awards_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_awards" ADD CONSTRAINT "community_awards_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_awards" ADD CONSTRAINT "community_awards_outcome_by_user_id_users_id_fk" FOREIGN KEY ("outcome_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_commentators" ADD CONSTRAINT "match_commentators_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_commentators" ADD CONSTRAINT "match_commentators_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_commentators" ADD CONSTRAINT "match_commentators_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_match_reports" ADD CONSTRAINT "post_match_reports_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_match_reports" ADD CONSTRAINT "post_match_reports_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "community_award_evidence_award_id_idx" ON "community_award_evidence" USING btree ("award_id");--> statement-breakpoint
CREATE INDEX "community_awards_season_id_status_idx" ON "community_awards" USING btree ("season_id","status");--> statement-breakpoint
CREATE INDEX "match_commentators_user_id_idx" ON "match_commentators" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "post_match_reports_submitted_by_user_id_idx" ON "post_match_reports" USING btree ("submitted_by_user_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."enforce_post_match_scope"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE match_season_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'match_commentators' AND TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM post_match_reports WHERE match_id = OLD.match_id) THEN RAISE EXCEPTION 'submitted commentator roster is immutable' USING ERRCODE = '23514'; END IF;
    RETURN OLD;
  END IF;
  SELECT season_id INTO match_season_id FROM matches WHERE id = NEW.match_id;
  IF match_season_id IS NULL THEN RAISE EXCEPTION 'match does not exist' USING ERRCODE = '23503'; END IF;
  IF TG_TABLE_NAME = 'match_commentators' THEN
    IF EXISTS (SELECT 1 FROM post_match_reports WHERE match_id = NEW.match_id) THEN RAISE EXCEPTION 'submitted commentator roster is immutable' USING ERRCODE = '23514'; END IF;
    IF NOT EXISTS (SELECT 1 FROM season_admin_grants WHERE season_id = match_season_id AND user_id = NEW.user_id) THEN RAISE EXCEPTION 'commentator must be a season admin' USING ERRCODE = '23514'; END IF;
    IF (SELECT count(*) FROM match_commentators WHERE match_id = NEW.match_id) >= 2 THEN RAISE EXCEPTION 'a match has at most two commentators' USING ERRCODE = '23514'; END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM match_commentators WHERE match_id = NEW.match_id AND user_id = NEW.submitted_by_user_id) THEN RAISE EXCEPTION 'submitter must be a registered commentator' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "match_commentators_scope_guard" BEFORE INSERT OR UPDATE OR DELETE ON "match_commentators" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_post_match_scope"();
--> statement-breakpoint
CREATE TRIGGER "post_match_reports_scope_guard" BEFORE INSERT OR UPDATE ON "post_match_reports" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_post_match_scope"();
