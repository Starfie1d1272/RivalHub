ALTER TABLE "matches" ADD COLUMN "gameplay_started_at" timestamp with time zone;
--> statement-breakpoint
-- All financial history is server-only and append-only.
DO $$ DECLARE tab text; BEGIN
  FOREACH tab IN ARRAY ARRAY['programs','accounts','markets','options','stakes','settlements','ledger','stage_milestones'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', 'bet_' || tab);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', 'bet_' || tab);
  END LOOP;
  FOREACH tab IN ARRAY ARRAY['accounts','options','stakes','settlements','ledger','stage_milestones'] LOOP
    EXECUTE format('CREATE TRIGGER bet_append_only BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.rivalhub_prediction_append_only()', 'bet_' || tab);
  END LOOP;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.rivalhub_bet_frozen_market() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_catalog AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (to_jsonb(NEW) - ARRAY['locked_at','voided_at','void_reason']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['locked_at','voided_at','void_reason'])
    OR (OLD.locked_at IS NOT NULL AND NEW.locked_at IS DISTINCT FROM OLD.locked_at)
    OR (OLD.voided_at IS NOT NULL AND (NEW.voided_at IS DISTINCT FROM OLD.voided_at OR NEW.void_reason IS DISTINCT FROM OLD.void_reason)) THEN
    RAISE EXCEPTION 'bet market identity, line and terminal locks are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER bet_frozen_market BEFORE UPDATE OR DELETE ON public.bet_markets FOR EACH ROW EXECUTE FUNCTION public.rivalhub_bet_frozen_market();
--> statement-breakpoint
CREATE FUNCTION public.rivalhub_bet_official_outbox() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_catalog AS $$
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
    UPDATE bet_markets SET locked_at=COALESCE(locked_at,clock_timestamp()) WHERE match_id=mid AND subject->>'mapId'=rowdata->>'id';
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
DO $$ DECLARE tab text; BEGIN
  FOREACH tab IN ARRAY ARRAY['matches','match_maps','match_veto_sessions','match_veto_appeals','match_veto_timeout_incidents','major_stage_runs','major_prestart_states','major_tournament_entrants','major_tournament_seeds','major_final_results','match_demo_imports','match_player_stats','event_rosters','event_roster_members'] LOOP
    EXECUTE format('CREATE TRIGGER bet_official_outbox AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.rivalhub_bet_official_outbox()',tab);
  END LOOP;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.rivalhub_gameplay_start_is_permanent() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_catalog AS $$
BEGIN
  IF TG_TABLE_NAME='matches' THEN
    IF OLD.gameplay_started_at IS NOT NULL AND NEW.gameplay_started_at IS DISTINCT FROM OLD.gameplay_started_at THEN RAISE EXCEPTION 'gameplay start is permanent' USING ERRCODE='23514'; END IF;
  ELSE
    IF OLD.started_at IS NOT NULL AND NEW.started_at IS DISTINCT FROM OLD.started_at THEN RAISE EXCEPTION 'map start is permanent' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER gameplay_start_permanent BEFORE UPDATE ON public.matches FOR EACH ROW EXECUTE FUNCTION public.rivalhub_gameplay_start_is_permanent();
CREATE TRIGGER gameplay_start_permanent BEFORE UPDATE ON public.match_maps FOR EACH ROW EXECUTE FUNCTION public.rivalhub_gameplay_start_is_permanent();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.rivalhub_bet_frozen_market(), public.rivalhub_bet_official_outbox(), public.rivalhub_gameplay_start_is_permanent() FROM PUBLIC, anon, authenticated;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."scheduler_job_is_due"(job_key text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  p_job_key text := $1;
BEGIN
  CASE p_job_key
    WHEN 'draft-timeout' THEN
      RETURN EXISTS (
        SELECT 1
        FROM public.draft_state
        WHERE is_active = true
          AND round_deadline IS NOT NULL
          AND round_deadline <= clock_timestamp()
      );
    WHEN 'check-registration-deadline' THEN
      RETURN EXISTS (
        SELECT 1
        FROM public.seasons
        WHERE status = 'registration'
          AND (
            (
              registration_opened_at IS NULL
              AND registration_opens_at IS NOT NULL
              AND registration_opens_at <= clock_timestamp()
              AND (registration_closes_at IS NULL OR clock_timestamp() < registration_closes_at)
            )
            OR (
              registration_closes_at IS NOT NULL
              AND registration_closes_at <= clock_timestamp()
            )
          )
      );
    WHEN 'match-time-auto-award' THEN
      RETURN EXISTS (
        SELECT 1
        FROM public.match_time_proposals
        WHERE status = 'pending'
          AND created_at <= clock_timestamp() - interval '24 hours'
      ) OR EXISTS (
        SELECT 1
        FROM public.matches
        WHERE status = 'scheduled'
          AND scheduled_at IS NULL
          AND completion_deadline IS NOT NULL
          AND completion_deadline <= clock_timestamp() + interval '24 hours'
      );
    WHEN 'cleanup-education-evidence', 'refresh-steam-profiles' THEN
      RETURN true;
    WHEN 'rebuild-statistics-projections' THEN
      -- Runtime owns the active reducer version and checks only missing IDs.
      -- A future algorithm upgrade must not be hidden by an older SQL version.
      RETURN true;
    WHEN 'settle-match-mvp' THEN
      RETURN EXISTS (
        SELECT 1 FROM public.matches AS mvp_match
        WHERE mvp_match.status = 'finished'
          AND mvp_match.completed_at <= clock_timestamp() - interval '24 hours'
          AND mvp_match.mvp_winner_user_id IS NULL
          AND EXISTS (
            SELECT 1 FROM public.match_mvp_votes AS vote
            WHERE vote.match_id = mvp_match.id AND vote.player_user_id IS NOT NULL
          )
      );
    WHEN 'reconcile-predictions' THEN
      RETURN EXISTS (SELECT 1 FROM public.prediction_jobs WHERE public.prediction_reconciliation_is_due(season_id)) OR EXISTS (SELECT 1 FROM public.bet_programs WHERE dirty);
    WHEN 'resolve-match-veto-timeouts' THEN
      RETURN EXISTS (
        SELECT 1
        FROM public.match_veto_sessions AS veto_session
        INNER JOIN public.matches AS veto_match ON veto_match.id = veto_session.match_id
        WHERE (
          veto_match.status = 'in_progress'
          AND veto_session.started_at IS NOT NULL
          AND veto_session.completed_at IS NULL
          AND veto_session.paused_at IS NULL
          AND veto_session.turn_deadline_at < clock_timestamp() - interval '2 seconds'
        ) OR (
          veto_match.status = 'scheduled'
          AND veto_session.started_at IS NULL
          AND veto_session.completed_at IS NULL
          AND (veto_session.entry_a_start_requested_at IS NOT NULL OR veto_session.entry_b_start_requested_at IS NOT NULL)
          AND (veto_match.scheduled_at IS NULL OR veto_match.scheduled_at <= clock_timestamp() + interval '15 minutes')
        )
      );
    ELSE
      RAISE EXCEPTION 'unknown scheduler job key' USING ERRCODE = '22023';
  END CASE;
END;
$$;
