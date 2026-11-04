-- These invoker functions use public tables, row types and helper functions.
-- Keep pg_catalog first and pg_temp last so neither caller paths nor temporary
-- relations can shadow those dependencies. Preserve function bodies and ACLs.
ALTER FUNCTION public.close_recruitment_intents_for_deleted_target_season() SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.community_award_recipients_lock() SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.community_awards_check_recipient_trigger() SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.community_awards_check_recipients(uuid) SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.rivalhub_assert_competition_entry_aggregate() SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.rivalhub_assert_competition_entry_current_state() SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.rivalhub_assert_event_roster_approved_source() SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.rivalhub_assert_event_roster_mutable() SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.rivalhub_assert_team_current_state() SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.rivalhub_assert_team_entry_history_append_only() SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.validate_major_final_result() SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
-- The shipped writer already maintains the complete recipient list and audit.
-- Remove the old singleton bridge, retaining the current projection and its
-- deferred consistency checks for the running application.
DROP TRIGGER community_awards_legacy_guard ON public.community_awards;
--> statement-breakpoint
DROP TRIGGER community_awards_legacy_sync ON public.community_awards;
--> statement-breakpoint
DROP FUNCTION public.community_awards_legacy_guard();
--> statement-breakpoint
DROP FUNCTION public.community_awards_legacy_sync();
--> statement-breakpoint
-- Preserve the existing versioned write surface, including explicit bumps from
-- policy/evidence writers. An update advances once even when it sets both a
-- result field and result_version; notes and evidence submission do not advance.
CREATE FUNCTION public.community_awards_advance_result_version() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  NEW.result_version := OLD.result_version + 1;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER community_awards_advance_result_version
BEFORE UPDATE OF status, recipient_user_id, outcome_note, outcome_at, outcome_by_user_id, result_version
ON public.community_awards
FOR EACH ROW EXECUTE FUNCTION public.community_awards_advance_result_version();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.community_awards_advance_result_version() FROM PUBLIC, anon, authenticated;
