ALTER TABLE "scheduled_job_health" ADD COLUMN "last_primary_dispatch_requested_at" timestamp with time zone;--> statement-breakpoint

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
    'refresh-steam-profiles'
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
    'refresh-steam-profiles'
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

CREATE OR REPLACE FUNCTION "public"."force_dispatch_rivalhub_scheduler_job"(job_key text)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT public.enqueue_rivalhub_scheduler_job($1);
$$;--> statement-breakpoint

REVOKE ALL PRIVILEGES ON FUNCTION "public"."scheduler_job_is_due"(text) FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION "public"."enqueue_rivalhub_scheduler_job"(text) FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION "public"."dispatch_rivalhub_scheduler_job"(text) FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION "public"."force_dispatch_rivalhub_scheduler_job"(text) FROM PUBLIC, anon, authenticated;
