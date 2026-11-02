-- Allow an explicit administrator rollback before any Major seed or StageRun is persisted.
-- A transaction-local flag is necessary but never sufficient: the official lock
-- must already be cleared, and the target roster remains source-identical.
CREATE OR REPLACE FUNCTION public.rivalhub_assert_event_roster_not_thawed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $rollback_guard$
BEGIN
  IF OLD.status = 'frozen' AND NEW.status <> 'frozen' THEN
    IF current_setting('rivalhub.major_entrant_rollback', true) IS DISTINCT FROM 'on'
       OR NEW.status <> 'confirmed'
       OR NEW.entry_id IS DISTINCT FROM OLD.entry_id
       OR NEW.source_roster_revision_id IS DISTINCT FROM OLD.source_roster_revision_id
       OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at
       OR NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by
       OR NEW.frozen_at IS NOT NULL
       OR NEW.frozen_by IS NOT NULL
       OR NOT EXISTS (
         SELECT 1
           FROM public.competition_entries ce
           JOIN public.major_prestart_states ps ON ps.season_id = ce.competition_id
          WHERE ce.id = OLD.entry_id
            AND ps.entrants_locked_at IS NULL
            AND ps.entrants_locked_by IS NULL
            AND ps.seeds_locked_at IS NULL
            AND ps.seeds_confirmed_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM public.major_tournament_seeds sd WHERE sd.season_id = ce.competition_id)
            AND NOT EXISTS (SELECT 1 FROM public.major_stage_runs sr WHERE sr.season_id = ce.competition_id)
       )
    THEN
      RAISE EXCEPTION 'frozen event roster cannot be reopened without a guarded pre-seeding Major rollback'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $rollback_guard$;
