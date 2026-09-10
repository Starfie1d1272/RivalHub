CREATE TABLE "prediction_stage_milestones" (
	"season_id" uuid NOT NULL,
	"stage_key" text NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	CONSTRAINT "prediction_stage_milestones_season_id_stage_key_unique" UNIQUE("season_id","stage_key")
);
--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed New empty milestone table; brief FK metadata lock, no existing-row rewrite.
ALTER TABLE "prediction_stage_milestones" ADD CONSTRAINT "prediction_stage_milestones_season_id_prediction_programs_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."prediction_programs"("season_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "prediction_stage_milestones" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "prediction_stage_milestones" FROM anon, authenticated;
--> statement-breakpoint
INSERT INTO prediction_stage_milestones(season_id,stage_key,opened_at)
SELECT r.season_id,r.stage_key,r.started_at FROM major_stage_runs r JOIN prediction_programs p ON p.season_id=r.season_id;
--> statement-breakpoint
CREATE TRIGGER prediction_append_only BEFORE UPDATE OR DELETE ON public.prediction_stage_milestones FOR EACH ROW EXECUTE FUNCTION public.rivalhub_prediction_append_only();
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
