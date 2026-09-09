CREATE TABLE "scheduled_job_health" (
	"job_key" text PRIMARY KEY NOT NULL,
	"last_primary_triggered_at" timestamp with time zone,
	"last_primary_endpoint_started_at" timestamp with time zone,
	"last_primary_endpoint_succeeded_at" timestamp with time zone,
	"last_watchdog_succeeded_at" timestamp with time zone,
	"last_manual_succeeded_at" timestamp with time zone,
	"last_business_transition_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"last_failure_source" text,
	"last_failure_code" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "scheduled_job_health" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "scheduled_job_health" FROM anon, authenticated;--> statement-breakpoint

-- Local PostgreSQL normally has neither extension. Supabase production may
-- expose both extensions, so enable them when the server can load them while
-- keeping plain migration replay valid. Release provisioning verifies that
-- the production extensions really exist before scheduling jobs.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    BEGIN
      EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_cron';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'pg_cron is available but could not be enabled during migration';
    END;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_net') THEN
    BEGIN
      EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_net';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'pg_net is available but could not be enabled during migration';
    END;
  END IF;
END $$;--> statement-breakpoint

-- The database helper only records a primary heartbeat and enqueues the
-- canonical HTTP route. It intentionally contains no domain transition.
CREATE OR REPLACE FUNCTION "public"."dispatch_rivalhub_scheduler_job"(job_key text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  base_url text;
  cron_secret text;
  request_id bigint;
BEGIN
  -- The protected TypeScript provisioning command owns the registered job
  -- set. Keep the DB helper limited to safe route segments so it cannot be
  -- used to construct an arbitrary URL path or query.
  IF job_key IS NULL OR job_key !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN
    RAISE EXCEPTION 'invalid scheduler job key' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.scheduled_job_health (job_key, last_primary_triggered_at, updated_at)
  VALUES (job_key, clock_timestamp(), clock_timestamp())
  ON CONFLICT (job_key) DO UPDATE SET
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
      base_url || '/api/cron/' || job_key,
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
