-- PostgreSQL does not allow CREATE OR REPLACE FUNCTION to rename an existing
-- input parameter. Keep the public signature stable and copy $1 into a local
-- name that cannot collide with scheduled_job_health.job_key.
CREATE OR REPLACE FUNCTION "public"."dispatch_rivalhub_scheduler_job"(job_key text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  p_job_key text := $1;
  base_url text;
  cron_secret text;
  request_id bigint;
BEGIN
  IF p_job_key IS NULL OR p_job_key !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN
    RAISE EXCEPTION 'invalid scheduler job key' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.scheduled_job_health (job_key, last_primary_triggered_at, updated_at)
  VALUES (p_job_key, clock_timestamp(), clock_timestamp())
  ON CONFLICT ON CONSTRAINT scheduled_job_health_pkey DO UPDATE SET
    last_primary_triggered_at = EXCLUDED.last_primary_triggered_at,
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

REVOKE ALL PRIVILEGES ON FUNCTION "public"."dispatch_rivalhub_scheduler_job"(text) FROM PUBLIC, anon, authenticated;
