CREATE OR REPLACE FUNCTION public.enqueue_match_veto_invalidation() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_catalog AS $$
DECLARE
  mid uuid;
  category jsonb;
  current_tx bigint;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    CASE TG_TABLE_NAME
      WHEN 'match_demo_imports' THEN
        IF ROW(OLD.status, OLD.evidence_revision, OLD.validated_revision, OLD.demo_sha256,
               OLD.payload_sha256, OLD.semantic_profile, OLD.analysis_version, OLD.created_at,
               OLD.match_id, OLD.match_map_id)
           IS NOT DISTINCT FROM
           ROW(NEW.status, NEW.evidence_revision, NEW.validated_revision, NEW.demo_sha256,
               NEW.payload_sha256, NEW.semantic_profile, NEW.analysis_version, NEW.created_at,
               NEW.match_id, NEW.match_map_id) THEN RETURN NEW; END IF;
      WHEN 'match_demo_stat_projections' THEN
        -- Transport sidecars are lossless encodings of the unchanged canonical facts.
        IF ROW(OLD.import_id, OLD.projection_version, OLD.payload_sha256, OLD.demo_sha256,
               OLD.semantic_profile, OLD.analysis_version, OLD.evidence_revision, OLD.identity_bindings)
           IS NOT DISTINCT FROM
           ROW(NEW.import_id, NEW.projection_version, NEW.payload_sha256, NEW.demo_sha256,
               NEW.semantic_profile, NEW.analysis_version, NEW.evidence_revision, NEW.identity_bindings)
           AND (OLD.facts - ARRAY['performanceTransport', 'tournamentTransport'])
             IS NOT DISTINCT FROM (NEW.facts - ARRAY['performanceTransport', 'tournamentTransport'])
           THEN RETURN NEW; END IF;
      WHEN 'match_maps' THEN
        IF ROW(OLD.match_id, OLD.map_order, OLD.map_name, OLD.picked_by_entry_id, OLD.team_a_start_side,
               OLD.score_a, OLD.score_b, OLD.started_at, OLD.completed_at)
           IS NOT DISTINCT FROM
           ROW(NEW.match_id, NEW.map_order, NEW.map_name, NEW.picked_by_entry_id, NEW.team_a_start_side,
               NEW.score_a, NEW.score_b, NEW.started_at, NEW.completed_at) THEN RETURN NEW; END IF;
      WHEN 'match_rosters' THEN
        IF ROW(OLD.match_id, OLD.entry_id, OLD.submitted_by, OLD.source, OLD.status, OLD.confirmed_by, OLD.confirmed_at)
           IS NOT DISTINCT FROM
           ROW(NEW.match_id, NEW.entry_id, NEW.submitted_by, NEW.source, NEW.status, NEW.confirmed_by, NEW.confirmed_at)
           THEN RETURN NEW; END IF;
      ELSE
        IF OLD IS NOT DISTINCT FROM NEW THEN RETURN NEW; END IF;
    END CASE;
  END IF;
  IF TG_TABLE_NAME = 'match_veto_appeals' THEN
    SELECT match_id INTO mid FROM match_veto_timeout_incidents
    WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.timeout_incident_id ELSE NEW.timeout_incident_id END;
  ELSIF TG_TABLE_NAME = 'match_roster_players' THEN
    SELECT match_id INTO mid FROM match_rosters
    WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.roster_id ELSE NEW.roster_id END;
  ELSIF TG_TABLE_NAME = 'match_demo_stat_projections' THEN
    SELECT match_id INTO mid FROM match_demo_imports
    WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.import_id ELSE NEW.import_id END;
  ELSIF TG_TABLE_NAME = 'matches' THEN
    mid := NEW.id;
  ELSE
    mid := CASE WHEN TG_OP = 'DELETE' THEN OLD.match_id ELSE NEW.match_id END;
  END IF;
  IF mid IS NULL OR NOT EXISTS (SELECT 1 FROM matches WHERE id = mid AND season_id IS NOT NULL) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  category := CASE
    WHEN TG_NARGS = 1 THEN jsonb_build_array(TG_ARGV[0])
    WHEN TG_TABLE_NAME = 'match_maps' THEN '["map_plan"]'::jsonb
    WHEN TG_TABLE_NAME = 'match_veto_appeals' THEN '["appeals"]'::jsonb
    WHEN TG_TABLE_NAME IN ('match_rosters', 'match_roster_players') THEN '["lineups"]'::jsonb
    ELSE '["veto_step"]'::jsonb
  END;
  current_tx := txid_current();
  INSERT INTO match_veto_invalidations(match_id,generation,published_generation,affected_facts,last_transaction_id)
    VALUES(mid,1,0,category,current_tx)
    ON CONFLICT(match_id) DO UPDATE SET
      generation=match_veto_invalidations.generation + CASE WHEN match_veto_invalidations.last_transaction_id=current_tx THEN 0 ELSE 1 END,
      affected_facts=CASE WHEN match_veto_invalidations.published_generation=match_veto_invalidations.generation THEN category
        ELSE (SELECT jsonb_agg(DISTINCT fact) FROM jsonb_array_elements(match_veto_invalidations.affected_facts || category) fact) END,
      last_transaction_id=current_tx,updated_at=clock_timestamp()
    WHERE match_veto_invalidations.last_transaction_id<>current_tx OR NOT match_veto_invalidations.affected_facts @> category;
  RETURN COALESCE(NEW,OLD);
END $$;
--> statement-breakpoint
CREATE OR REPLACE TRIGGER statistics_invalidation_result
AFTER UPDATE OF status, score_a, score_b, entry_a_id, entry_b_id, season_id, stage, round,
  format, major_stage_run_id, is_forfeit, completed_at, test_config, mvp_winner_user_id ON public.matches
FOR EACH ROW
WHEN ((OLD.status IN ('in_progress', 'finished') OR NEW.status IN ('in_progress', 'finished'))
  AND ROW(OLD.status, OLD.score_a, OLD.score_b, OLD.entry_a_id, OLD.entry_b_id, OLD.season_id,
    OLD.stage, OLD.round, OLD.format, OLD.major_stage_run_id, OLD.is_forfeit, OLD.completed_at,
    OLD.test_config IS NULL, OLD.mvp_winner_user_id)
  IS DISTINCT FROM ROW(NEW.status, NEW.score_a, NEW.score_b, NEW.entry_a_id, NEW.entry_b_id, NEW.season_id,
    NEW.stage, NEW.round, NEW.format, NEW.major_stage_run_id, NEW.is_forfeit, NEW.completed_at,
    NEW.test_config IS NULL, NEW.mvp_winner_user_id))
EXECUTE FUNCTION public.enqueue_match_veto_invalidation('statistics');
--> statement-breakpoint
CREATE OR REPLACE TRIGGER statistics_invalidation_import
AFTER INSERT OR DELETE OR UPDATE OF status, evidence_revision, validated_revision, demo_sha256,
  payload_sha256, semantic_profile, analysis_version, created_at, match_id, match_map_id ON public.match_demo_imports
FOR EACH ROW EXECUTE FUNCTION public.enqueue_match_veto_invalidation('statistics');
--> statement-breakpoint
CREATE OR REPLACE TRIGGER statistics_invalidation_scoreboard_update
AFTER UPDATE OF match_id, map_id, perfect_name, user_id, kills, deaths, assists, hs_percent, first_kills,
  first_deaths, multi_kills, trade_kills, kast_rounds, clutches, adr, rws, rating_pro, we,
  dak_import_id, verified_by_admin ON public.match_player_stats
FOR EACH ROW
WHEN ((OLD.verified_by_admin IS NOT NULL OR NEW.verified_by_admin IS NOT NULL)
  AND ROW(OLD.match_id, OLD.map_id, OLD.perfect_name, OLD.user_id, OLD.kills, OLD.deaths, OLD.assists,
    OLD.hs_percent, OLD.first_kills, OLD.first_deaths, OLD.multi_kills, OLD.trade_kills, OLD.kast_rounds,
    OLD.clutches, OLD.adr, OLD.rws, OLD.rating_pro, OLD.we, OLD.dak_import_id, OLD.verified_by_admin IS NOT NULL)
  IS DISTINCT FROM ROW(NEW.match_id, NEW.map_id, NEW.perfect_name, NEW.user_id, NEW.kills, NEW.deaths, NEW.assists,
    NEW.hs_percent, NEW.first_kills, NEW.first_deaths, NEW.multi_kills, NEW.trade_kills, NEW.kast_rounds,
    NEW.clutches, NEW.adr, NEW.rws, NEW.rating_pro, NEW.we, NEW.dak_import_id, NEW.verified_by_admin IS NOT NULL))
EXECUTE FUNCTION public.enqueue_match_veto_invalidation('statistics');
