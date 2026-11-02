-- Legacy writers must already be isolated. Hold the same snapshot locks as the offline verifier.
SET LOCAL TIME ZONE 'UTC';
--> statement-breakpoint
LOCK TABLE public.matches, public.major_stage_runs, public.major_final_results, public.prediction_markets, public.prediction_market_options, public.prediction_accounts, public.prediction_stakes, public.prediction_settlements, public.prediction_ledger IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
DO $$
DECLARE snapshot_digest text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.prediction_markets) OR EXISTS (SELECT 1 FROM public.prediction_ledger WHERE kind IN ('stake', 'settlement') OR source LIKE 'stake/%' OR source LIKE 'settlement/%' OR source LIKE 'reversal/%' OR (kind = 'reversal' AND source NOT LIKE 'void/%')) THEN
    SELECT encode(sha256(convert_to(jsonb_build_object(
  'accounts', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) FROM public.prediction_accounts t),
  'markets', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) FROM public.prediction_markets t),
  'options', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) FROM public.prediction_market_options t),
  'stakes', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) FROM public.prediction_stakes t),
  'settlements', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) FROM public.prediction_settlements t),
  'ledger', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) FROM public.prediction_ledger t),
  'matches', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) FROM public.matches t),
  'runs', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) FROM public.major_stage_runs t),
  'finals', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) FROM public.major_final_results t)
)::text, 'UTF8')), 'hex') INTO snapshot_digest;
    IF NOT EXISTS (
      SELECT 1 FROM public.audit_logs a
      WHERE a.action = 'predictions.retire_finance' AND a.target_type = 'prediction_finance_retirement'
        AND a.actor_id IS NOT NULL AND a.actor_id <> ''
        AND a.meta->>'version' = '1' AND a.meta->>'snapshotDigest' = snapshot_digest
        AND nullif(a.meta->>'reason', '') IS NOT NULL
        AND jsonb_array_length(a.meta->'markets') = (SELECT count(*) FROM public.prediction_markets)
    ) THEN RAISE EXCEPTION 'legacy prediction finance requires a matching verified retirement snapshot'; END IF;
  END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.rivalhub_reject_legacy_prediction_finance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'legacy prediction finance is retired' USING ERRCODE = '23514';
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS prediction_finance_retired ON public.prediction_markets;
--> statement-breakpoint
CREATE TRIGGER prediction_finance_retired BEFORE INSERT OR UPDATE OR DELETE ON public.prediction_markets FOR EACH ROW EXECUTE FUNCTION public.rivalhub_reject_legacy_prediction_finance();
--> statement-breakpoint
DROP TRIGGER IF EXISTS prediction_finance_retired ON public.prediction_market_options;
--> statement-breakpoint
CREATE TRIGGER prediction_finance_retired BEFORE INSERT OR UPDATE OR DELETE ON public.prediction_market_options FOR EACH ROW EXECUTE FUNCTION public.rivalhub_reject_legacy_prediction_finance();
--> statement-breakpoint
DROP TRIGGER IF EXISTS prediction_finance_retired ON public.prediction_stakes;
--> statement-breakpoint
CREATE TRIGGER prediction_finance_retired BEFORE INSERT OR UPDATE OR DELETE ON public.prediction_stakes FOR EACH ROW EXECUTE FUNCTION public.rivalhub_reject_legacy_prediction_finance();
--> statement-breakpoint
DROP TRIGGER IF EXISTS prediction_finance_retired ON public.prediction_settlements;
--> statement-breakpoint
CREATE TRIGGER prediction_finance_retired BEFORE INSERT OR UPDATE OR DELETE ON public.prediction_settlements FOR EACH ROW EXECUTE FUNCTION public.rivalhub_reject_legacy_prediction_finance();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.rivalhub_guard_retired_prediction_ledger() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_catalog AS $$
BEGIN
  IF TG_OP <> 'INSERT' AND (OLD.kind IN ('stake', 'settlement') OR OLD.source LIKE 'stake/%' OR OLD.source LIKE 'settlement/%' OR OLD.source LIKE 'reversal/%' OR (OLD.kind = 'reversal' AND OLD.source NOT LIKE 'void/%')) THEN
    RAISE EXCEPTION 'legacy prediction finance is retired' USING ERRCODE = '23514';
  END IF;
  IF TG_OP <> 'DELETE' AND (NEW.kind IN ('stake', 'settlement') OR NEW.source LIKE 'stake/%' OR NEW.source LIKE 'settlement/%' OR NEW.source LIKE 'reversal/%' OR (NEW.kind = 'reversal' AND NEW.source NOT LIKE 'void/%')) THEN
    RAISE EXCEPTION 'legacy prediction finance is retired' USING ERRCODE = '23514';
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.kind = 'reversal' AND NEW.source LIKE 'void/%' AND NOT EXISTS (
    SELECT 1 FROM public.prediction_ledger reward WHERE NEW.source = 'void/' || reward.id::text
      AND reward.kind = 'participation' AND reward.season_id = NEW.season_id AND reward.account_id = NEW.account_id
      AND NEW.amount = -reward.amount AND NEW.profit = -reward.profit
  ) THEN RAISE EXCEPTION 'invalid PickEm participation reversal' USING ERRCODE = '23514'; END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS prediction_finance_retired ON public.prediction_ledger;
--> statement-breakpoint
CREATE TRIGGER prediction_finance_retired BEFORE INSERT OR UPDATE OR DELETE ON public.prediction_ledger FOR EACH ROW EXECUTE FUNCTION public.rivalhub_guard_retired_prediction_ledger();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.prediction_reconciliation_is_due(target_season_id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public, pg_catalog AS $$
  SELECT EXISTS (SELECT 1 FROM public.prediction_jobs WHERE season_id = target_season_id AND dirty)
    OR EXISTS (SELECT 1 FROM public.prediction_contests WHERE season_id = target_season_id AND locked_at IS NULL AND deadline <= clock_timestamp());
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.rivalhub_enqueue_predictions() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE sid uuid;
BEGIN
  sid := COALESCE(NEW.season_id, OLD.season_id);
  IF NOT EXISTS (SELECT 1 FROM prediction_programs WHERE season_id = sid) THEN RETURN COALESCE(NEW,OLD); END IF;
  INSERT INTO prediction_jobs(season_id,dirty,updated_at) VALUES(sid,true,clock_timestamp()) ON CONFLICT(season_id) DO UPDATE SET dirty=true,updated_at=clock_timestamp();
  IF TG_TABLE_NAME = 'major_stage_runs' AND TG_OP = 'INSERT' THEN
    INSERT INTO prediction_stage_milestones(season_id,stage_key,opened_at)
    VALUES(NEW.season_id,NEW.stage_key,NEW.started_at) ON CONFLICT(season_id,stage_key) DO NOTHING;
  END IF;
  UPDATE prediction_contests SET locked_at=COALESCE(locked_at,clock_timestamp()) WHERE season_id=sid AND deadline <= clock_timestamp();
  IF TG_TABLE_NAME = 'matches' THEN
    IF TG_OP <> 'DELETE' AND NEW.status IN ('in_progress','finished') THEN
      UPDATE prediction_contests SET locked_at=COALESCE(locked_at,clock_timestamp()) WHERE season_id=sid AND stage_key=NEW.stage;
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'matches' THEN
    UPDATE prediction_contests c SET deadline=(
      SELECT min(m.scheduled_at) FROM matches m
      WHERE m.season_id=sid AND m.stage=c.stage_key AND m.ownership='major_stage' AND m.status <> 'cancelled'
    ) WHERE c.season_id=sid AND c.locked_at IS NULL;
    UPDATE prediction_contests SET locked_at=COALESCE(locked_at,clock_timestamp()) WHERE season_id=sid AND deadline <= clock_timestamp();
  END IF;
  RETURN COALESCE(NEW,OLD);
END $$;
