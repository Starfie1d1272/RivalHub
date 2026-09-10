CREATE TABLE "prediction_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "prediction_accounts_season_id_user_id_unique" UNIQUE("season_id","user_id"),
	CONSTRAINT "prediction_accounts_id_season_id_unique" UNIQUE("id","season_id")
);
--> statement-breakpoint
CREATE TABLE "prediction_contests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"stage_key" text NOT NULL,
	"kind" text NOT NULL,
	"entrants" jsonb NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"locked_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "prediction_contests_season_id_stage_key_unique" UNIQUE("season_id","stage_key"),
	CONSTRAINT "prediction_contests_id_season_id_unique" UNIQUE("id","season_id"),
	CONSTRAINT "prediction_contest_kind" CHECK ("prediction_contests"."kind" IN ('swiss','single_elim'))
);
--> statement-breakpoint
CREATE TABLE "prediction_jobs" (
	"season_id" uuid PRIMARY KEY NOT NULL,
	"dirty" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prediction_judgements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contest_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"actual" jsonb,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prediction_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"profit" bigint DEFAULT 0 NOT NULL,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "prediction_ledger_account_id_source_unique" UNIQUE("account_id","source"),
	CONSTRAINT "prediction_ledger_kind" CHECK ("prediction_ledger"."kind" IN ('initial','stage','participation','stake','settlement','reversal'))
);
--> statement-breakpoint
CREATE TABLE "prediction_markets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"match_id" uuid NOT NULL,
	"stage_key" text NOT NULL,
	"entry_a_id" uuid NOT NULL,
	"entry_b_id" uuid NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "prediction_markets_match_id_unique" UNIQUE("match_id"),
	CONSTRAINT "prediction_markets_id_season_id_unique" UNIQUE("id","season_id"),
	CONSTRAINT "prediction_market_pair" CHECK ("prediction_markets"."entry_a_id" <> "prediction_markets"."entry_b_id")
);
--> statement-breakpoint
CREATE TABLE "prediction_picks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"contest_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"request_id" uuid NOT NULL,
	"submitted" boolean NOT NULL,
	"pick" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "prediction_picks_account_id_request_id_unique" UNIQUE("account_id","request_id"),
	CONSTRAINT "prediction_picks_contest_id_account_id_version_unique" UNIQUE("contest_id","account_id","version"),
	CONSTRAINT "prediction_pick_version" CHECK ("prediction_picks"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "prediction_programs" (
	"season_id" uuid PRIMARY KEY NOT NULL,
	"rules" jsonb NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prediction_scenarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"name" text NOT NULL,
	"baseline" jsonb NOT NULL,
	"choices" jsonb NOT NULL,
	"projection" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prediction_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"state" text NOT NULL,
	"winner" uuid,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "prediction_settlement_state" CHECK ("prediction_settlements"."state" IN ('pending','settled','refunded'))
);
--> statement-breakpoint
CREATE TABLE "prediction_stakes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"market_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"side" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "prediction_stakes_account_id_request_id_unique" UNIQUE("account_id","request_id"),
	CONSTRAINT "prediction_stake_positive" CHECK ("prediction_stakes"."amount" > 0)
);
--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed New empty prediction tables; short FK metadata locks on referenced identities, no existing-row rewrite.
ALTER TABLE "prediction_accounts" ADD CONSTRAINT "prediction_accounts_season_id_prediction_programs_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."prediction_programs"("season_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed New empty prediction tables; short FK metadata locks on referenced identities, no existing-row rewrite.
ALTER TABLE "prediction_accounts" ADD CONSTRAINT "prediction_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed New empty prediction tables; short FK metadata locks on referenced identities, no existing-row rewrite.
ALTER TABLE "prediction_contests" ADD CONSTRAINT "prediction_contests_season_id_prediction_programs_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."prediction_programs"("season_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed New empty prediction tables; short FK metadata locks on referenced identities, no existing-row rewrite.
ALTER TABLE "prediction_jobs" ADD CONSTRAINT "prediction_jobs_season_id_prediction_programs_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."prediction_programs"("season_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed New empty prediction tables; short FK metadata locks on referenced identities, no existing-row rewrite.
ALTER TABLE "prediction_judgements" ADD CONSTRAINT "prediction_judgements_contest_id_prediction_contests_id_fk" FOREIGN KEY ("contest_id") REFERENCES "public"."prediction_contests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed New empty prediction tables; short FK metadata locks on referenced identities, no existing-row rewrite.
ALTER TABLE "prediction_ledger" ADD CONSTRAINT "prediction_ledger_account_id_season_id_prediction_accounts_id_season_id_fk" FOREIGN KEY ("account_id","season_id") REFERENCES "public"."prediction_accounts"("id","season_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed New empty prediction tables; short FK metadata locks on referenced identities, no existing-row rewrite.
ALTER TABLE "prediction_markets" ADD CONSTRAINT "prediction_markets_season_id_prediction_programs_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."prediction_programs"("season_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed New empty prediction tables; short FK metadata locks on referenced identities, no existing-row rewrite.
ALTER TABLE "prediction_picks" ADD CONSTRAINT "prediction_picks_contest_id_season_id_prediction_contests_id_season_id_fk" FOREIGN KEY ("contest_id","season_id") REFERENCES "public"."prediction_contests"("id","season_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed New empty prediction tables; short FK metadata locks on referenced identities, no existing-row rewrite.
ALTER TABLE "prediction_picks" ADD CONSTRAINT "prediction_picks_account_id_season_id_prediction_accounts_id_season_id_fk" FOREIGN KEY ("account_id","season_id") REFERENCES "public"."prediction_accounts"("id","season_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed New empty prediction tables; short FK metadata locks on referenced identities, no existing-row rewrite.
ALTER TABLE "prediction_programs" ADD CONSTRAINT "prediction_programs_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed New empty prediction tables; short FK metadata locks on referenced identities, no existing-row rewrite.
ALTER TABLE "prediction_scenarios" ADD CONSTRAINT "prediction_scenarios_season_id_prediction_programs_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."prediction_programs"("season_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed New empty prediction tables; short FK metadata locks on referenced identities, no existing-row rewrite.
ALTER TABLE "prediction_scenarios" ADD CONSTRAINT "prediction_scenarios_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed New empty prediction tables; short FK metadata locks on referenced identities, no existing-row rewrite.
ALTER TABLE "prediction_settlements" ADD CONSTRAINT "prediction_settlements_market_id_prediction_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."prediction_markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed New empty prediction tables; short FK metadata locks on referenced identities, no existing-row rewrite.
ALTER TABLE "prediction_stakes" ADD CONSTRAINT "prediction_stakes_market_id_season_id_prediction_markets_id_season_id_fk" FOREIGN KEY ("market_id","season_id") REFERENCES "public"."prediction_markets"("id","season_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed New empty prediction tables; short FK metadata locks on referenced identities, no existing-row rewrite.
ALTER TABLE "prediction_stakes" ADD CONSTRAINT "prediction_stakes_account_id_season_id_prediction_accounts_id_season_id_fk" FOREIGN KEY ("account_id","season_id") REFERENCES "public"."prediction_accounts"("id","season_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- All prediction tables are server-only; public DTOs are built by the domain reader.
ALTER TABLE "prediction_programs" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "prediction_programs" FROM anon, authenticated;
ALTER TABLE "prediction_contests" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "prediction_contests" FROM anon, authenticated;
ALTER TABLE "prediction_accounts" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "prediction_accounts" FROM anon, authenticated;
ALTER TABLE "prediction_picks" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "prediction_picks" FROM anon, authenticated;
ALTER TABLE "prediction_judgements" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "prediction_judgements" FROM anon, authenticated;
ALTER TABLE "prediction_markets" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "prediction_markets" FROM anon, authenticated;
ALTER TABLE "prediction_stakes" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "prediction_stakes" FROM anon, authenticated;
ALTER TABLE "prediction_settlements" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "prediction_settlements" FROM anon, authenticated;
ALTER TABLE "prediction_ledger" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "prediction_ledger" FROM anon, authenticated;
ALTER TABLE "prediction_scenarios" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "prediction_scenarios" FROM anon, authenticated;
ALTER TABLE "prediction_jobs" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "prediction_jobs" FROM anon, authenticated;
--> statement-breakpoint
CREATE FUNCTION public.rivalhub_prediction_append_only() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'prediction history is append-only' USING ERRCODE = '23514'; END $$;
--> statement-breakpoint
DO $$ DECLARE tab text; BEGIN
  FOREACH tab IN ARRAY ARRAY['picks','judgements','stakes','settlements','ledger','scenarios','accounts'] LOOP
    EXECUTE format('CREATE TRIGGER prediction_append_only BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.rivalhub_prediction_append_only()', 'prediction_' || tab);
  END LOOP;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.rivalhub_prediction_frozen_config() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_TABLE_NAME = 'prediction_programs' THEN
    IF (to_jsonb(NEW) - 'paused') IS DISTINCT FROM (to_jsonb(OLD) - 'paused') THEN RAISE EXCEPTION 'prediction rules are frozen' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME = 'prediction_markets' THEN
    IF (to_jsonb(NEW)-'locked_at'-'deadline') IS DISTINCT FROM (to_jsonb(OLD)-'locked_at'-'deadline') OR NEW.deadline > OLD.deadline OR (OLD.locked_at IS NOT NULL AND NEW.locked_at IS DISTINCT FROM OLD.locked_at) THEN RAISE EXCEPTION 'market identity and lock are frozen' USING ERRCODE='23514'; END IF;
  ELSE
    IF (to_jsonb(NEW)-'locked_at'-'deadline'-'voided_at'-'void_reason') IS DISTINCT FROM (to_jsonb(OLD)-'locked_at'-'deadline'-'voided_at'-'void_reason') OR NEW.deadline > OLD.deadline OR (OLD.locked_at IS NOT NULL AND NEW.locked_at IS DISTINCT FROM OLD.locked_at) OR (OLD.voided_at IS NOT NULL AND NEW.voided_at IS DISTINCT FROM OLD.voided_at) THEN RAISE EXCEPTION 'contest identity and lock are frozen' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER prediction_frozen_config BEFORE UPDATE ON public.prediction_programs FOR EACH ROW EXECUTE FUNCTION public.rivalhub_prediction_frozen_config();
--> statement-breakpoint
CREATE TRIGGER prediction_frozen_config BEFORE UPDATE ON public.prediction_markets FOR EACH ROW EXECUTE FUNCTION public.rivalhub_prediction_frozen_config();
--> statement-breakpoint
CREATE TRIGGER prediction_frozen_config BEFORE UPDATE ON public.prediction_contests FOR EACH ROW EXECUTE FUNCTION public.rivalhub_prediction_frozen_config();
--> statement-breakpoint
-- Constant-time outbox insertion is atomic with official edits. No settlement runs here.
-- Lock order is official match -> job -> prediction rows; workers never lock matches.
CREATE FUNCTION public.rivalhub_enqueue_predictions() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE sid uuid; point_cutoff timestamptz;
BEGIN
  sid := COALESCE(NEW.season_id, OLD.season_id);
  IF NOT EXISTS (SELECT 1 FROM prediction_programs WHERE season_id = sid) THEN RETURN COALESCE(NEW,OLD); END IF;
  INSERT INTO prediction_jobs(season_id,dirty,updated_at) VALUES(sid,true,clock_timestamp()) ON CONFLICT(season_id) DO UPDATE SET dirty=true,updated_at=clock_timestamp();
  IF TG_TABLE_NAME = 'matches' THEN
    IF TG_OP = 'DELETE' THEN
      UPDATE prediction_markets SET locked_at=COALESCE(locked_at,clock_timestamp()) WHERE match_id=OLD.id;
    ELSE
      IF NEW.status <> 'scheduled' THEN
        UPDATE prediction_markets SET locked_at=COALESCE(locked_at,clock_timestamp()) WHERE match_id=NEW.id;
      END IF;
      IF NEW.status IN ('in_progress','finished') THEN
        UPDATE prediction_contests SET locked_at=COALESCE(locked_at,clock_timestamp()) WHERE season_id=sid AND stage_key=NEW.stage;
      END IF;
      IF TG_OP = 'UPDATE' AND (NEW.entry_a_id <> OLD.entry_a_id OR NEW.entry_b_id <> OLD.entry_b_id) THEN
        UPDATE prediction_markets SET locked_at=COALESCE(locked_at,clock_timestamp()) WHERE match_id=NEW.id;
      END IF;
      IF NEW.scheduled_at IS NOT NULL THEN
        SELECT NEW.scheduled_at - make_interval(mins => (rules->>'cutoffMinutes')::int) INTO point_cutoff FROM prediction_programs WHERE season_id=sid;
        UPDATE prediction_markets SET deadline=LEAST(deadline,point_cutoff) WHERE match_id=NEW.id;
        UPDATE prediction_contests SET deadline=LEAST(deadline,NEW.scheduled_at) WHERE season_id=sid AND stage_key=NEW.stage;
      END IF;
    END IF;
  END IF;
  RETURN COALESCE(NEW,OLD);
END $$;
--> statement-breakpoint
CREATE TRIGGER prediction_official_outbox AFTER INSERT OR DELETE OR UPDATE OF status,score_a,score_b,completed_at,entry_a_id,entry_b_id,scheduled_at ON public.matches FOR EACH ROW EXECUTE FUNCTION public.rivalhub_enqueue_predictions();
--> statement-breakpoint
CREATE TRIGGER prediction_official_outbox AFTER INSERT OR UPDATE OR DELETE ON public.major_stage_runs FOR EACH ROW EXECUTE FUNCTION public.rivalhub_enqueue_predictions();
--> statement-breakpoint
CREATE TRIGGER prediction_official_outbox AFTER INSERT OR UPDATE OR DELETE ON public.major_final_results FOR EACH ROW EXECUTE FUNCTION public.rivalhub_enqueue_predictions();
