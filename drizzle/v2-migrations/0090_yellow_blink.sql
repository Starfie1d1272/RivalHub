CREATE TABLE "community_award_recipients" (
	"award_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "community_award_recipients_award_id_user_id_pk" PRIMARY KEY("award_id","user_id"),
	CONSTRAINT "community_award_recipients_position_check" CHECK ("community_award_recipients"."position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "community_award_evidence" ADD COLUMN "verification_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "community_award_evidence" ADD COLUMN "verified_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "community_award_evidence" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "community_award_evidence" ADD COLUMN "verification_note" text;--> statement-breakpoint
ALTER TABLE "community_awards" ADD COLUMN "recipient_policy" text DEFAULT 'single' NOT NULL;--> statement-breakpoint
ALTER TABLE "community_awards" ADD COLUMN "recipient_limit" integer DEFAULT 1;--> statement-breakpoint
ALTER TABLE "community_awards" ADD COLUMN "settlement_policy" text DEFAULT 'season_complete' NOT NULL;--> statement-breakpoint
ALTER TABLE "community_awards" ADD COLUMN "settlement_stage_key" text;--> statement-breakpoint
ALTER TABLE "community_awards" ADD COLUMN "result_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed New empty relation; FK validation before backfill, no existing rows to scan.
ALTER TABLE "community_award_recipients" ADD CONSTRAINT "community_award_recipients_award_id_community_awards_id_fk" FOREIGN KEY ("award_id") REFERENCES "public"."community_awards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed New empty relation; FK validation before backfill, no existing rows to scan.
ALTER TABLE "community_award_recipients" ADD CONSTRAINT "community_award_recipients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed Additive verification contract; existing evidence defaults pending with null review fields, bounded validation scan.
ALTER TABLE "community_award_evidence" ADD CONSTRAINT "community_award_evidence_verified_by_user_id_users_id_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed Additive verification contract; existing evidence defaults pending with null review fields, bounded validation scan.
ALTER TABLE "community_award_evidence" ADD CONSTRAINT "community_award_evidence_verification_check" CHECK (("community_award_evidence"."verification_status" = 'pending' AND "community_award_evidence"."verified_by_user_id" IS NULL AND "community_award_evidence"."verified_at" IS NULL AND "community_award_evidence"."verification_note" IS NULL) OR ("community_award_evidence"."verification_status" IN ('eligible', 'ineligible') AND "community_award_evidence"."verified_by_user_id" IS NOT NULL AND "community_award_evidence"."verified_at" IS NOT NULL AND "community_award_evidence"."verification_note" IS NOT NULL AND length(trim("community_award_evidence"."verification_note")) > 0));--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed Additive conservative defaults satisfy all historical awards; bounded validation scan, no result rewritten.
ALTER TABLE "community_awards" ADD CONSTRAINT "community_awards_recipient_policy_check" CHECK (("community_awards"."recipient_policy" = 'single' AND "community_awards"."recipient_limit" IS NOT NULL AND "community_awards"."recipient_limit" = 1) OR ("community_awards"."recipient_policy" = 'limited' AND "community_awards"."recipient_limit" IS NOT NULL AND "community_awards"."recipient_limit" >= 2) OR ("community_awards"."recipient_policy" = 'all_ties' AND "community_awards"."recipient_limit" IS NULL));--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed Additive conservative defaults satisfy all historical awards; bounded validation scan, no result rewritten.
ALTER TABLE "community_awards" ADD CONSTRAINT "community_awards_settlement_policy_check" CHECK (("community_awards"."settlement_policy" IN ('event_verified', 'play_in_complete', 'season_complete') AND "community_awards"."settlement_stage_key" IS NULL) OR ("community_awards"."settlement_policy" = 'stage_complete' AND "community_awards"."settlement_stage_key" IS NOT NULL AND length(trim("community_awards"."settlement_stage_key")) > 0));
--> statement-breakpoint
-- Expand/backfill: keep the shipped single-recipient column and its CHECK intact.
INSERT INTO community_award_recipients (award_id, user_id, position)
SELECT id, recipient_user_id, 0 FROM community_awards WHERE status = 'awarded' AND recipient_user_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE community_award_recipients ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE community_award_recipients FROM anon, authenticated;
--> statement-breakpoint
-- Legacy writers may maintain singleton results, but cannot truncate a new-policy outcome
-- or bypass conservative season completion. New writer updates both facts in one transaction.
CREATE FUNCTION community_awards_legacy_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('rivalhub.community_awards_writer', true) IS DISTINCT FROM 'recipients-v1' THEN
    IF NEW.status IN ('awarded', 'not_awarded', 'cancelled') THEN
      IF NEW.recipient_policy <> 'single' OR (SELECT count(*) FROM community_award_recipients WHERE award_id = NEW.id) > 1 THEN
        RAISE EXCEPTION 'Use the current community award result writer for multiple recipients' USING ERRCODE = '23514';
      END IF;
      IF NEW.status <> 'cancelled' AND (NEW.settlement_policy <> 'season_complete' OR NOT EXISTS (
        SELECT 1 FROM seasons s WHERE s.id = NEW.season_id AND
        CASE WHEN s.competition_template = 'major' THEN EXISTS (SELECT 1 FROM major_final_results f WHERE f.season_id = s.id AND f.status = 'confirmed')
        ELSE s.status IN ('finished', 'archived') END
      )) THEN
        RAISE EXCEPTION 'Community award settlement is not ready for a legacy writer' USING ERRCODE = '23514';
      END IF;
    END IF;
    IF TG_OP = 'UPDATE' THEN NEW.result_version := OLD.result_version + 1; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER community_awards_legacy_guard BEFORE INSERT OR UPDATE OF status, recipient_user_id, outcome_note, outcome_at, outcome_by_user_id ON community_awards
FOR EACH ROW EXECUTE FUNCTION community_awards_legacy_guard();
--> statement-breakpoint
CREATE FUNCTION community_awards_legacy_sync() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('rivalhub.community_awards_writer', true) IS DISTINCT FROM 'recipients-v1' THEN
    DELETE FROM community_award_recipients WHERE award_id = NEW.id;
    IF NEW.status = 'awarded' THEN
      INSERT INTO community_award_recipients (award_id, user_id, position) VALUES (NEW.id, NEW.recipient_user_id, 0);
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.status IN ('awarded', 'not_awarded', 'cancelled') THEN
      INSERT INTO audit_logs (season_id, action, actor_id, target_id, target_type, meta)
      VALUES (NEW.season_id, 'community_award.legacy.resolve', NEW.outcome_by_user_id::text, NEW.id::text, 'community_award', jsonb_build_object(
        'previousStatus', OLD.status, 'status', NEW.status,
        'previousRecipientUserIds', CASE WHEN OLD.recipient_user_id IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(OLD.recipient_user_id) END,
        'recipientUserIds', CASE WHEN NEW.recipient_user_id IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(NEW.recipient_user_id) END,
        'previousOutcomeNote', OLD.outcome_note, 'outcomeNote', NEW.outcome_note));
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER community_awards_legacy_sync AFTER INSERT OR UPDATE OF status, recipient_user_id, outcome_note, outcome_at, outcome_by_user_id ON community_awards
FOR EACH ROW EXECUTE FUNCTION community_awards_legacy_sync();
--> statement-breakpoint
CREATE FUNCTION community_awards_check_recipients(target uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE a community_awards; n integer;
BEGIN
  SELECT * INTO a FROM community_awards WHERE id = target;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT count(*) INTO n FROM community_award_recipients WHERE award_id = target;
  IF (a.status = 'awarded' AND (n < 1 OR NOT EXISTS (SELECT 1 FROM community_award_recipients WHERE award_id = target AND user_id = a.recipient_user_id)))
    OR (a.status <> 'awarded' AND n <> 0)
    OR (a.recipient_policy <> 'all_ties' AND n > a.recipient_limit) THEN
    RAISE EXCEPTION 'Community award outcome and recipient relation disagree' USING ERRCODE = '23514';
  END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION community_awards_check_recipient_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'community_awards' THEN
    PERFORM community_awards_check_recipients(NEW.id);
  ELSE
    IF TG_OP <> 'INSERT' THEN PERFORM community_awards_check_recipients(OLD.award_id); END IF;
    IF TG_OP <> 'DELETE' THEN PERFORM community_awards_check_recipients(NEW.award_id); END IF;
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER community_awards_recipient_consistency AFTER INSERT OR UPDATE ON community_awards
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION community_awards_check_recipient_trigger();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER community_award_recipients_consistency AFTER INSERT OR UPDATE OR DELETE ON community_award_recipients
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION community_awards_check_recipient_trigger();
--> statement-breakpoint
CREATE FUNCTION community_award_recipients_lock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN PERFORM 1 FROM community_awards WHERE id = OLD.award_id FOR UPDATE; END IF;
  IF TG_OP <> 'DELETE' THEN PERFORM 1 FROM community_awards WHERE id = NEW.award_id FOR UPDATE; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER community_award_recipients_lock BEFORE INSERT OR UPDATE OR DELETE ON community_award_recipients
FOR EACH ROW EXECUTE FUNCTION community_award_recipients_lock();
--> statement-breakpoint
REVOKE ALL ON FUNCTION community_awards_legacy_guard(), community_awards_legacy_sync(), community_awards_check_recipients(uuid), community_awards_check_recipient_trigger(), community_award_recipients_lock() FROM PUBLIC, anon, authenticated;
