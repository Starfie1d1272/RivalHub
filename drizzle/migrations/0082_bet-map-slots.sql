-- Extend the existing official outbox; preserve legacy map-ID locks and all frozen terms.
CREATE OR REPLACE FUNCTION public.rivalhub_bet_official_outbox() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_catalog AS $$
DECLARE rowdata jsonb := CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  sid uuid; mid uuid; matchrow public.matches;
BEGIN
  IF TG_TABLE_NAME IN ('matches','major_stage_runs','major_prestart_states','major_tournament_entrants','major_tournament_seeds','major_final_results','match_demo_imports') THEN
    sid := (rowdata->>'season_id')::uuid;
    IF TG_TABLE_NAME='matches' THEN mid := (rowdata->>'id')::uuid; END IF;
  ELSIF TG_TABLE_NAME IN ('match_maps','match_veto_sessions','match_player_stats','match_veto_timeout_incidents') THEN
    mid := (rowdata->>'match_id')::uuid;
    SELECT * INTO matchrow FROM matches WHERE id=mid; sid := matchrow.season_id;
  ELSIF TG_TABLE_NAME='match_veto_appeals' THEN
    SELECT m.* INTO matchrow FROM matches m JOIN match_veto_timeout_incidents i ON i.match_id=m.id WHERE i.id=(rowdata->>'timeout_incident_id')::uuid;
    sid:=matchrow.season_id; mid:=matchrow.id;
  ELSIF TG_TABLE_NAME='event_rosters' THEN
    SELECT competition_id INTO sid FROM competition_entries WHERE id=(rowdata->>'entry_id')::uuid;
  ELSIF TG_TABLE_NAME='event_roster_members' THEN
    SELECT e.competition_id INTO sid FROM event_rosters r JOIN competition_entries e ON e.id=r.entry_id WHERE r.id=(rowdata->>'event_roster_id')::uuid;
  END IF;
  IF sid IS NULL THEN RETURN COALESCE(NEW,OLD); END IF;
  -- Serialize before touching market rows, matching workers and administrative operations.
  -- Workers never lock official rows, so an official writer can safely wait here.
  PERFORM 1 FROM bet_programs WHERE season_id=sid FOR UPDATE;
  -- Lock financial admission in the official transaction, never wait for settlement.
  IF TG_TABLE_NAME='matches' THEN
    IF TG_OP='DELETE' OR rowdata->>'status' IN ('finished','cancelled') OR (rowdata->>'is_forfeit')::boolean
      OR (TG_OP='UPDATE' AND (NEW.entry_a_id IS DISTINCT FROM OLD.entry_a_id OR NEW.entry_b_id IS DISTINCT FROM OLD.entry_b_id OR NEW.format IS DISTINCT FROM OLD.format OR NEW.major_stage_run_id IS DISTINCT FROM OLD.major_stage_run_id OR NEW.qualification_run_id IS DISTINCT FROM OLD.qualification_run_id)) THEN
      UPDATE bet_markets SET locked_at=COALESCE(locked_at,clock_timestamp()) WHERE match_id=mid;
    ELSIF rowdata->>'gameplay_started_at' IS NOT NULL THEN
      UPDATE bet_markets SET locked_at=COALESCE(locked_at,clock_timestamp()) WHERE match_id=mid AND (subject->>'kind'='match' OR subject->>'mapOrder'='1');
    END IF;
  ELSIF TG_TABLE_NAME='match_veto_sessions' AND rowdata->>'started_at' IS NOT NULL THEN
    UPDATE bet_markets SET locked_at=COALESCE(locked_at,clock_timestamp()) WHERE match_id=mid AND type LIKE 'veto_%';
    IF matchrow.major_stage_run_id IS NOT NULL THEN
      UPDATE bet_markets SET locked_at=COALESCE(locked_at,clock_timestamp()) WHERE season_id=sid AND subject->>'kind'='event';
    END IF;
  ELSIF TG_TABLE_NAME='match_maps' AND (rowdata->>'started_at' IS NOT NULL OR rowdata->>'completed_at' IS NOT NULL) THEN
    -- A confirmed map start/result proves the series has begun, even when the
    -- operator did not separately record gameplay_started_at.
    UPDATE bet_markets SET locked_at=COALESCE(locked_at,clock_timestamp()) WHERE match_id=mid AND (subject->>'kind'='match' OR subject->>'mapId'=rowdata->>'id' OR (subject->>'kind'='map_slot' AND (subject->>'mapOrder')::integer <= (rowdata->>'map_order')::integer));
    IF matchrow.major_stage_run_id IS NOT NULL THEN
      UPDATE bet_markets SET locked_at=COALESCE(locked_at,clock_timestamp()) WHERE season_id=sid AND subject->>'kind'='event';
    END IF;
  END IF;
  -- Lock remaining map pools at confirmed clinch even before match.finished.
  -- Corrections may change winners/refunds, but never erase a financial lock.
  IF TG_TABLE_NAME='match_maps' AND EXISTS (
    SELECT 1 FROM match_maps mm WHERE mm.match_id=mid AND mm.completed_at IS NOT NULL
    GROUP BY mm.match_id HAVING
      count(*) FILTER (WHERE mm.score_a > mm.score_b) >= CASE matchrow.format WHEN 'bo1' THEN 1 WHEN 'bo3' THEN 2 ELSE 3 END
      OR count(*) FILTER (WHERE mm.score_b > mm.score_a) >= CASE matchrow.format WHEN 'bo1' THEN 1 WHEN 'bo3' THEN 2 ELSE 3 END
  ) THEN
    UPDATE bet_markets SET locked_at=COALESCE(locked_at,clock_timestamp())
      WHERE match_id=mid AND subject->>'kind' IN ('map','map_slot');
  END IF;
  IF TG_TABLE_NAME='matches' AND rowdata->>'gameplay_started_at' IS NOT NULL AND rowdata->>'major_stage_run_id' IS NOT NULL THEN
    UPDATE bet_markets SET locked_at=COALESCE(locked_at,clock_timestamp()) WHERE season_id=sid AND subject->>'kind'='event';
  END IF;
  UPDATE bet_programs SET dirty=true,updated_at=clock_timestamp() WHERE season_id=sid;
  IF TG_TABLE_NAME='major_stage_runs' AND TG_OP='INSERT' AND EXISTS(SELECT 1 FROM bet_programs WHERE season_id=sid) THEN
    INSERT INTO bet_stage_milestones(season_id,stage_key,opened_at) VALUES(sid,NEW.stage_key,NEW.started_at) ON CONFLICT DO NOTHING;
  END IF;
  RETURN COALESCE(NEW,OLD);
END $$;
--> statement-breakpoint
-- Request normal worker publication for existing programs; no financial history is rewritten.
UPDATE public.bet_programs SET dirty=true, updated_at=clock_timestamp();
