-- Existing one-argument cron commands remain safe during reader-only rollout.
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
      RETURN EXISTS (SELECT 1 FROM public.prediction_jobs WHERE public.prediction_reconciliation_is_due(season_id)) OR EXISTS (SELECT 1 FROM public.bet_programs WHERE dirty OR catalog_version < 2);
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

--> statement-breakpoint
CREATE FUNCTION public.scheduler_job_is_due(job_key text, publish_veto_closure boolean)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
BEGIN
  IF public.scheduler_job_is_due(job_key) THEN RETURN true; END IF;
  IF job_key <> 'resolve-match-veto-timeouts' OR NOT COALESCE(publish_veto_closure, false) THEN RETURN false; END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.match_veto_sessions veto_session
    JOIN public.matches veto_match ON veto_match.id = veto_session.match_id
    WHERE EXISTS (SELECT 1 FROM public.match_veto_appeals appeal
      JOIN public.match_veto_timeout_incidents incident ON incident.id = appeal.timeout_incident_id
      WHERE incident.match_id = veto_match.id AND appeal.status = 'pending')
    AND (veto_match.gameplay_started_at IS NOT NULL OR EXISTS (
      SELECT 1 FROM public.match_maps played_map WHERE played_map.match_id = veto_match.id
      AND (played_map.started_at IS NOT NULL OR played_map.score_a IS NOT NULL OR played_map.score_b IS NOT NULL OR played_map.completed_at IS NOT NULL)))
  );
END;
$$;
--> statement-breakpoint
CREATE FUNCTION "public"."dispatch_rivalhub_scheduler_job"(job_key text, publish_veto_closure boolean)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  p_job_key text := $1;
  checked_at timestamptz := clock_timestamp();
BEGIN
  IF p_job_key NOT IN (
    'draft-timeout',
    'check-registration-deadline',
    'match-time-auto-award',
    'cleanup-education-evidence',
    'refresh-steam-profiles',
    'resolve-match-veto-timeouts',
    'reconcile-predictions',
    'settle-match-mvp',
    'rebuild-statistics-projections'
  ) THEN
    RAISE EXCEPTION 'unknown scheduler job key' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.scheduled_job_health (job_key, last_primary_triggered_at, updated_at)
  VALUES (p_job_key, checked_at, checked_at)
  ON CONFLICT ON CONSTRAINT scheduled_job_health_pkey DO UPDATE SET
    last_primary_triggered_at = EXCLUDED.last_primary_triggered_at,
    updated_at = EXCLUDED.updated_at;

  IF NOT public.scheduler_job_is_due(p_job_key, publish_veto_closure) THEN
    RETURN NULL::bigint;
  END IF;

  RETURN public.enqueue_rivalhub_scheduler_job(p_job_key);
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.dispatch_rivalhub_scheduler_job(job_key text)
RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_catalog
AS $$ SELECT public.dispatch_rivalhub_scheduler_job(job_key, false); $$;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION public.scheduler_job_is_due(text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.dispatch_rivalhub_scheduler_job(text, boolean) FROM PUBLIC, anon, authenticated;
