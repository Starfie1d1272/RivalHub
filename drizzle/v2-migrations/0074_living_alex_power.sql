ALTER TABLE "prediction_contests" ALTER COLUMN "stage_run_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "prediction_contests" ALTER COLUMN "deadline" DROP NOT NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.rivalhub_prediction_frozen_config() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_TABLE_NAME = 'prediction_programs' THEN
    IF (to_jsonb(NEW) - 'paused') IS DISTINCT FROM (to_jsonb(OLD) - 'paused') THEN RAISE EXCEPTION 'prediction rules are frozen' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME = 'prediction_markets' THEN
    IF (to_jsonb(NEW)-'locked_at'-'deadline') IS DISTINCT FROM (to_jsonb(OLD)-'locked_at'-'deadline') OR NEW.deadline > OLD.deadline OR (OLD.locked_at IS NOT NULL AND NEW.locked_at IS DISTINCT FROM OLD.locked_at) THEN RAISE EXCEPTION 'market identity and lock are frozen' USING ERRCODE='23514'; END IF;
  ELSE
    IF (to_jsonb(NEW)-'stage_run_id'-'locked_at'-'deadline'-'voided_at'-'void_reason') IS DISTINCT FROM (to_jsonb(OLD)-'stage_run_id'-'locked_at'-'deadline'-'voided_at'-'void_reason') OR (OLD.stage_run_id IS NOT NULL AND NEW.stage_run_id IS DISTINCT FROM OLD.stage_run_id) OR (OLD.locked_at IS NOT NULL AND NEW.deadline IS DISTINCT FROM OLD.deadline) OR (OLD.locked_at IS NOT NULL AND NEW.locked_at IS DISTINCT FROM OLD.locked_at) OR (OLD.voided_at IS NOT NULL AND NEW.voided_at IS DISTINCT FROM OLD.voided_at) THEN RAISE EXCEPTION 'contest identity and lock are frozen' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.rivalhub_enqueue_predictions() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE sid uuid; point_cutoff timestamptz;
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

      END IF;
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
--> statement-breakpoint
CREATE TRIGGER prediction_official_outbox AFTER INSERT OR UPDATE OR DELETE ON public.major_prestart_states FOR EACH ROW EXECUTE FUNCTION public.rivalhub_enqueue_predictions();
--> statement-breakpoint
CREATE TRIGGER prediction_official_outbox AFTER INSERT OR UPDATE OR DELETE ON public.major_tournament_seeds FOR EACH ROW EXECUTE FUNCTION public.rivalhub_enqueue_predictions();
--> statement-breakpoint
CREATE TRIGGER prediction_official_outbox AFTER INSERT OR UPDATE OR DELETE ON public.major_tournament_entrants FOR EACH ROW EXECUTE FUNCTION public.rivalhub_enqueue_predictions();
