-- rivalhub:migration-risk: contract-cleanup Add a lifecycle-only enum value; existing pending/accepted/rejected facts and meanings remain valid.
ALTER TYPE "public"."match_veto_appeal_status" ADD VALUE 'closed';--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed Replace the appeal shape check in one migration transaction; no row rewrite or historical backfill.
ALTER TABLE "match_veto_appeals" DROP CONSTRAINT "match_veto_appeals_resolution_shape_check";--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed Validate existing human adjudications and permit system closure with no impersonated user; table constraint validation requires a migration-time lock.
ALTER TABLE "match_veto_appeals" ADD CONSTRAINT "match_veto_appeals_resolution_shape_check" CHECK (("match_veto_appeals"."status" = 'pending' AND "match_veto_appeals"."resolution_scope" IS NULL AND "match_veto_appeals"."resolved_by" IS NULL AND "match_veto_appeals"."resolved_at" IS NULL)
      OR ("match_veto_appeals"."status" IN ('accepted', 'rejected') AND "match_veto_appeals"."resolution_scope" IS NOT NULL AND "match_veto_appeals"."resolved_by" IS NOT NULL AND "match_veto_appeals"."resolved_at" IS NOT NULL)
      OR ("match_veto_appeals"."status"::text = 'closed' AND "match_veto_appeals"."resolution_scope" IS NULL AND "match_veto_appeals"."resolved_by" IS NULL AND "match_veto_appeals"."resolved_at" IS NOT NULL AND "match_veto_appeals"."resolution_note" IS NOT NULL));
--> statement-breakpoint
-- Existing scheduler repairs only pending appeals backed by actual gameplay evidence.
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
        ) OR (
          EXISTS (SELECT 1 FROM public.match_veto_appeals appeal
            JOIN public.match_veto_timeout_incidents incident ON incident.id = appeal.timeout_incident_id
            WHERE incident.match_id = veto_match.id AND appeal.status = 'pending')
          AND (veto_match.gameplay_started_at IS NOT NULL OR EXISTS (
            SELECT 1 FROM public.match_maps played_map WHERE played_map.match_id = veto_match.id
            AND (played_map.started_at IS NOT NULL OR played_map.score_a IS NOT NULL OR played_map.score_b IS NOT NULL OR played_map.completed_at IS NOT NULL)))
        )
      );
    ELSE
      RAISE EXCEPTION 'unknown scheduler job key' USING ERRCODE = '22023';
  END CASE;
END;
$$;
