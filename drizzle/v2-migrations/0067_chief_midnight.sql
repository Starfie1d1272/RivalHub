CREATE TABLE "match_demo_stat_projections" (
	"import_id" uuid NOT NULL,
	"projection_version" text NOT NULL,
	"payload_sha256" text NOT NULL,
	"demo_sha256" text NOT NULL,
	"semantic_profile" text NOT NULL,
	"analysis_version" text NOT NULL,
	"evidence_revision" text NOT NULL,
	"identity_bindings" jsonb NOT NULL,
	"facts" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_demo_stat_projections_import_id_projection_version_pk" PRIMARY KEY("import_id","projection_version"),
	CONSTRAINT "match_demo_stat_projections_sha_shape_check" CHECK ("match_demo_stat_projections"."payload_sha256" ~ '^[a-f0-9]{64}$' AND "match_demo_stat_projections"."demo_sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "match_demo_stat_projections_bindings_shape_check" CHECK (jsonb_typeof("match_demo_stat_projections"."identity_bindings") = 'array' AND jsonb_array_length("match_demo_stat_projections"."identity_bindings") = 10),
	CONSTRAINT "match_demo_stat_projections_facts_shape_check" CHECK (jsonb_typeof("match_demo_stat_projections"."facts") = 'object' AND "match_demo_stat_projections"."facts" ? 'tournament' AND "match_demo_stat_projections"."facts" ? 'performance')
);
--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed New empty projection table; additive FK does not rewrite existing application tables.
ALTER TABLE "match_demo_stat_projections" ADD CONSTRAINT "match_demo_stat_projections_import_id_match_demo_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."match_demo_imports"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Derived statistics are served only through authorized server read models.
REVOKE ALL PRIVILEGES ON TABLE "match_demo_stat_projections" FROM anon, authenticated;
--> statement-breakpoint
ALTER TABLE "match_demo_stat_projections" ENABLE ROW LEVEL SECURITY;
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
      RETURN EXISTS (SELECT 1 FROM public.prediction_jobs WHERE public.prediction_reconciliation_is_due(season_id));
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
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION "public"."enqueue_rivalhub_scheduler_job"(job_key text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  p_job_key text := $1;
  base_url text;
  cron_secret text;
  requested_at timestamptz := clock_timestamp();
  request_id bigint;
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

  INSERT INTO public.scheduled_job_health (job_key, last_primary_dispatch_requested_at, updated_at)
  VALUES (p_job_key, requested_at, requested_at)
  ON CONFLICT ON CONSTRAINT scheduled_job_health_pkey DO UPDATE SET
    last_primary_dispatch_requested_at = EXCLUDED.last_primary_dispatch_requested_at,
    updated_at = EXCLUDED.updated_at;

  IF to_regnamespace('vault') IS NULL THEN
    RAISE EXCEPTION 'scheduler vault is unavailable' USING ERRCODE = '0A000';
  END IF;
  EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1'
    INTO base_url USING 'rivalhub_scheduler_base_url';
  EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1'
    INTO cron_secret USING 'rivalhub_cron_secret';
  IF NULLIF(trim(base_url), '') IS NULL OR NULLIF(cron_secret, '') IS NULL THEN
    RAISE EXCEPTION 'scheduler credentials are unavailable' USING ERRCODE = '22023';
  END IF;

  IF to_regnamespace('net') IS NULL THEN
    RAISE EXCEPTION 'scheduler HTTP extension is unavailable' USING ERRCODE = '0A000';
  END IF;
  base_url := regexp_replace(trim(base_url), '/+$', '');
  EXECUTE 'SELECT net.http_get($1, $2::jsonb, $3::jsonb, $4)'
    INTO request_id
    USING
      base_url || '/api/cron/' || p_job_key,
      '{}'::jsonb,
      jsonb_build_object(
        'Authorization', 'Bearer ' || cron_secret,
        'X-RivalHub-Cron-Source', 'supabase-primary'
      ),
      10000;
  RETURN request_id;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION "public"."dispatch_rivalhub_scheduler_job"(job_key text)
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

  IF NOT public.scheduler_job_is_due(p_job_key) THEN
    RETURN NULL::bigint;
  END IF;

  RETURN public.enqueue_rivalhub_scheduler_job(p_job_key);
END;
$$;--> statement-breakpoint

REVOKE ALL PRIVILEGES ON FUNCTION "public"."scheduler_job_is_due"(text) FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION "public"."enqueue_rivalhub_scheduler_job"(text) FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION "public"."dispatch_rivalhub_scheduler_job"(text) FROM PUBLIC, anon, authenticated;
