-- rivalhub:migration-risk: locking-reviewed The replacement check widens the allowed set of the bounded per-match watermark.
ALTER TABLE "match_veto_invalidations" DROP CONSTRAINT "match_veto_invalidations_facts_check";--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed Validate the widened categories on the per-match watermark.
ALTER TABLE "match_veto_invalidations" ADD CONSTRAINT "match_veto_invalidations_facts_check" CHECK (jsonb_typeof("match_veto_invalidations"."affected_facts") = 'array' AND "match_veto_invalidations"."affected_facts" <@ '["lineups","appeals","veto_step","map_plan","veto","statistics"]'::jsonb AND jsonb_array_length("match_veto_invalidations"."affected_facts") <= 6);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.enqueue_match_veto_invalidation() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_catalog AS $$
DECLARE
  mid uuid;
  category jsonb;
  current_tx bigint := txid_current();
BEGIN
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
REVOKE ALL ON FUNCTION public.enqueue_match_veto_invalidation() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER statistics_invalidation_result
AFTER UPDATE OF status, score_a, score_b, entry_a_id, entry_b_id, season_id, stage, major_stage_run_id, completed_at, test_config ON public.matches
FOR EACH ROW
WHEN (OLD IS DISTINCT FROM NEW AND (OLD.status IN ('in_progress', 'finished') OR NEW.status IN ('in_progress', 'finished')))
EXECUTE FUNCTION public.enqueue_match_veto_invalidation('statistics');
--> statement-breakpoint
CREATE TRIGGER statistics_invalidation_import
AFTER INSERT OR DELETE OR UPDATE OF status, evidence_revision, validated_revision, demo_sha256, payload_sha256, semantic_profile, analysis_version ON public.match_demo_imports
FOR EACH ROW EXECUTE FUNCTION public.enqueue_match_veto_invalidation('statistics');
--> statement-breakpoint
CREATE TRIGGER statistics_invalidation_projection
AFTER INSERT OR UPDATE OR DELETE ON public.match_demo_stat_projections
FOR EACH ROW EXECUTE FUNCTION public.enqueue_match_veto_invalidation('statistics');
--> statement-breakpoint
CREATE TRIGGER statistics_invalidation_scoreboard_write
AFTER INSERT ON public.match_player_stats FOR EACH ROW
WHEN (NEW.verified_by_admin IS NOT NULL) EXECUTE FUNCTION public.enqueue_match_veto_invalidation('statistics');
--> statement-breakpoint
CREATE TRIGGER statistics_invalidation_scoreboard_update
AFTER UPDATE ON public.match_player_stats FOR EACH ROW
WHEN (OLD IS DISTINCT FROM NEW AND (OLD.verified_by_admin IS NOT NULL OR NEW.verified_by_admin IS NOT NULL))
EXECUTE FUNCTION public.enqueue_match_veto_invalidation('statistics');
--> statement-breakpoint
CREATE TRIGGER statistics_invalidation_scoreboard_delete
AFTER DELETE ON public.match_player_stats FOR EACH ROW
WHEN (OLD.verified_by_admin IS NOT NULL) EXECUTE FUNCTION public.enqueue_match_veto_invalidation('statistics');
