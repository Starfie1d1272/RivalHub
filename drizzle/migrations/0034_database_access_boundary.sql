-- Issue #395: every current application-owned public table is server-only.
-- Keep the Data API deny-by-default and add RLS as defense in depth. The
-- browser only uses Supabase Auth; Draft/Captain live updates use their
-- existing polling fallback, so no application table belongs in Realtime.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
--> statement-breakpoint
ALTER TABLE "admin_invite_claims" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "admin_invites" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "captain_votes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "community_award_evidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "community_awards" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "competition_bracket_states" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "competition_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "competition_entry_active_claims" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "competition_entry_legacy_identities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "competition_entry_participants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "competition_entry_representative_changes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "competition_entry_roster_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "competition_entry_roster_revisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "competition_entry_submissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "competitive_platform_ranks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "competitive_platform_seasons" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "competitive_platforms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "competitive_rank_facts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "disciplinary_case_idempotency" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "disciplinary_cases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "draft_picks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "draft_state" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "education_verifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "event_roster_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "event_rosters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "institution_email_domains" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "institutions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "major_final_results" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "major_prestart_issues" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "major_prestart_states" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "major_stage_entrants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "major_stage_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "major_tournament_entrants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "major_tournament_seeds" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "match_commentators" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "match_maps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "match_mvp_votes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "match_player_stats" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "match_roster_players" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "match_rosters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "match_time_proposals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "match_veto_steps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "matches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "post_event_adjudications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "post_match_reports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recruitment_intents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recruitment_interests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "registration_drafts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "season_admin_grants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "season_registrations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "seasons" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "swiss_standings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "team_captain_changes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "team_invitations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "team_memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "team_name_changes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "team_slug_aliases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "teams" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tournament_honors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_competitive_roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_map_preferences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
DECLARE
  table_name text;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication
    WHERE pubname = 'supabase_realtime' AND puballtables
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = '0034 refuses a FOR ALL TABLES supabase_realtime publication; narrow the publication before migration';
  END IF;

  FOR table_name IN
    SELECT unnest(ARRAY[
      'admin_invite_claims',
      'admin_invites',
      'audit_logs',
      'captain_votes',
      'community_award_evidence',
      'community_awards',
      'competition_bracket_states',
      'competition_entries',
      'competition_entry_active_claims',
      'competition_entry_legacy_identities',
      'competition_entry_participants',
      'competition_entry_representative_changes',
      'competition_entry_roster_members',
      'competition_entry_roster_revisions',
      'competition_entry_submissions',
      'competitive_platform_ranks',
      'competitive_platform_seasons',
      'competitive_platforms',
      'competitive_rank_facts',
      'disciplinary_case_idempotency',
      'disciplinary_cases',
      'draft_picks',
      'draft_state',
      'education_verifications',
      'event_roster_members',
      'event_rosters',
      'institution_email_domains',
      'institutions',
      'major_final_results',
      'major_prestart_issues',
      'major_prestart_states',
      'major_stage_entrants',
      'major_stage_runs',
      'major_tournament_entrants',
      'major_tournament_seeds',
      'match_commentators',
      'match_maps',
      'match_mvp_votes',
      'match_player_stats',
      'match_roster_players',
      'match_rosters',
      'match_time_proposals',
      'match_veto_steps',
      'matches',
      'post_event_adjudications',
      'post_match_reports',
      'recruitment_intents',
      'recruitment_interests',
      'registration_drafts',
      'season_admin_grants',
      'season_registrations',
      'seasons',
      'swiss_standings',
      'team_captain_changes',
      'team_invitations',
      'team_memberships',
      'team_name_changes',
      'team_slug_aliases',
      'teams',
      'tournament_honors',
      'user_competitive_roles',
      'user_map_preferences',
      'user_sessions',
      'users'
    ]::text[])
  LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_publication AS publication
      JOIN pg_publication_rel AS publication_relation
        ON publication_relation.prpubid = publication.oid
      JOIN pg_class AS table_object
        ON table_object.oid = publication_relation.prrelid
      JOIN pg_namespace AS table_schema
        ON table_schema.oid = table_object.relnamespace
      WHERE publication.pubname = 'supabase_realtime'
        AND table_schema.nspname = 'public'
        AND table_object.relname = table_name
    ) THEN
      EXECUTE format(
        'ALTER PUBLICATION %I DROP TABLE %I.%I',
        'supabase_realtime',
        'public',
        table_name
      );
    END IF;
  END LOOP;
END $$;
