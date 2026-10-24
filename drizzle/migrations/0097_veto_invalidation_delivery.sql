CREATE TABLE "match_veto_invalidations" (
	"match_id" uuid PRIMARY KEY NOT NULL,
	"generation" bigint DEFAULT 1 NOT NULL,
	"published_generation" bigint DEFAULT 0 NOT NULL,
	"affected_facts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_transaction_id" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_veto_invalidations_facts_check" CHECK (jsonb_typeof("affected_facts") = 'array' AND "affected_facts" <@ '["lineups","appeals","veto","map_plan"]'::jsonb AND jsonb_array_length("affected_facts") <= 4),
	CONSTRAINT "match_veto_invalidations_generation_check" CHECK ("match_veto_invalidations"."generation" > 0 AND "match_veto_invalidations"."published_generation" >= 0 AND "match_veto_invalidations"."published_generation" <= "match_veto_invalidations"."generation")
);
--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed Foreign key belongs to a new empty delivery-watermark table.
ALTER TABLE "match_veto_invalidations" ADD CONSTRAINT "match_veto_invalidations_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed Pending-only index on the new empty delivery-watermark table.
CREATE INDEX "match_veto_invalidations_pending_idx" ON "match_veto_invalidations" USING btree ("updated_at") WHERE "match_veto_invalidations"."generation" > "match_veto_invalidations"."published_generation";--> statement-breakpoint

--> statement-breakpoint
ALTER TABLE public.match_veto_invalidations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.match_veto_invalidations FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
-- Cache delivery generation is coalesced once per match per transaction. The
-- authoritative facts and their pending generation commit or roll back together.
CREATE FUNCTION public.enqueue_match_veto_invalidation() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_catalog AS $$
DECLARE data jsonb := CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  mid uuid; category jsonb; current_tx bigint := txid_current();
BEGIN
  IF TG_TABLE_NAME='match_veto_appeals' THEN
    SELECT match_id INTO mid FROM match_veto_timeout_incidents WHERE id=(data->>'timeout_incident_id')::uuid;
  ELSIF TG_TABLE_NAME='match_roster_players' THEN
    SELECT match_id INTO mid FROM match_rosters WHERE id=(data->>'roster_id')::uuid;
  ELSE
    mid := (data->>'match_id')::uuid;
  END IF;
  -- Parent deletion already cascades the watermark; never recreate an orphan.
  IF mid IS NULL OR NOT EXISTS (SELECT 1 FROM matches WHERE id=mid AND season_id IS NOT NULL) THEN
    RETURN COALESCE(NEW,OLD);
  END IF;
  category := CASE WHEN TG_TABLE_NAME='match_maps' THEN '["map_plan"]'::jsonb WHEN TG_TABLE_NAME='match_veto_appeals' THEN '["appeals"]'::jsonb
    WHEN TG_TABLE_NAME IN ('match_rosters','match_roster_players') THEN '["lineups"]'::jsonb ELSE '["veto"]'::jsonb END;
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
DO $$ DECLARE tab text; BEGIN
  FOREACH tab IN ARRAY ARRAY['match_veto_sessions','match_veto_steps','match_veto_timeout_incidents','match_veto_appeals','match_rosters','match_roster_players','match_maps'] LOOP
    EXECUTE format('CREATE TRIGGER veto_invalidation_delivery AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.enqueue_match_veto_invalidation()',tab);
  END LOOP;
END $$;
--> statement-breakpoint
-- A bounded scheduler drains pre-existing rooms once. No private facts or
-- financial history are copied, changed or deleted.
INSERT INTO public.match_veto_invalidations(match_id,generation,published_generation,affected_facts,last_transaction_id)
SELECT id,1,0,'["lineups","appeals","veto","map_plan"]'::jsonb,txid_current() FROM public.matches m
WHERE season_id IS NOT NULL AND (EXISTS (SELECT 1 FROM public.match_veto_sessions v WHERE v.match_id=m.id)
  OR EXISTS (SELECT 1 FROM public.match_rosters r WHERE r.match_id=m.id))
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Preserve every existing due gate, including the independently gated appeal publisher.
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
        FROM public.matches AS scheduled_match
        WHERE scheduled_match.status = 'scheduled'
          AND scheduled_match.season_id IS NOT NULL
          AND scheduled_match.test_config IS NULL
          AND scheduled_match.scheduled_at <= clock_timestamp() + interval '2 hours'
          AND (
            NOT EXISTS (SELECT 1 FROM public.match_rosters roster
              WHERE roster.match_id = scheduled_match.id AND roster.entry_id = scheduled_match.entry_a_id)
            OR NOT EXISTS (SELECT 1 FROM public.match_rosters roster
              WHERE roster.match_id = scheduled_match.id AND roster.entry_id = scheduled_match.entry_b_id)
          )
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
      RETURN EXISTS (SELECT 1 FROM public.prediction_jobs WHERE public.prediction_reconciliation_is_due(season_id)) OR EXISTS (SELECT 1 FROM public.bet_programs WHERE dirty OR catalog_version < 4);
    WHEN 'resolve-match-veto-timeouts' THEN
      RETURN EXISTS (SELECT 1 FROM public.match_veto_invalidations WHERE generation > published_generation) OR EXISTS (
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
