-- Generated from scripts/db/preview/policy.ts by reader-sql.ts.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rivalhub_preview_exporter') THEN
    CREATE ROLE rivalhub_preview_exporter NOLOGIN NOINHERIT CONNECTION LIMIT 1;
  END IF;
END $$;
--> statement-breakpoint
ALTER ROLE rivalhub_preview_exporter SET default_transaction_read_only = on;
ALTER ROLE rivalhub_preview_exporter SET statement_timeout = '60s';
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS rivalhub_preview;
REVOKE ALL ON SCHEMA rivalhub_preview FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA rivalhub_preview TO rivalhub_preview_exporter;
DO $$ BEGIN
  IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN
    GRANT USAGE ON SCHEMA drizzle TO rivalhub_preview_exporter;
    GRANT SELECT (hash, created_at) ON drizzle.__drizzle_migrations TO rivalhub_preview_exporter;
  END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION rivalhub_preview.export_table(table_name text) RETURNS SETOF jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  CASE table_name
    WHEN 'announcements' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "id", "scope", "season_id", "type", "title", "body", "status", "requires_attention", "attention_until", "published_at", "created_by", "updated_by", "created_at", "updated_at" FROM public."announcements" AS source WHERE (source.season_id IS NULL OR EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = source.season_id AND s.status <> 'draft')) AND source.status = 'published'
      ) AS mirror_row;
    WHEN 'captain_votes' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "id", "voter_registration_id", "candidate_registration_id", "created_at" FROM public."captain_votes" AS source WHERE EXISTS (SELECT 1 FROM public.season_registrations r WHERE r.id = source.voter_registration_id AND EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = r.season_id AND s.status <> 'draft')) AND EXISTS (SELECT 1 FROM public.season_registrations r WHERE r.id = source.candidate_registration_id AND EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = r.season_id AND s.status <> 'draft'))
      ) AS mirror_row;
    WHEN 'community_award_recipients' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "award_id", "user_id", "position" FROM public."community_award_recipients" AS source WHERE EXISTS (SELECT 1 FROM public.community_awards a WHERE a.id = source.award_id AND a.status = 'awarded' AND EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = a.season_id AND s.status <> 'draft'))
      ) AS mirror_row;
    WHEN 'community_awards' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "id", "season_id", "submitted_by_user_id", "name", "condition", "prize", "public_note", "status", "reviewed_by_user_id", "reviewed_at", "recipient_policy", "recipient_limit", "settlement_policy", "settlement_stage_key", "result_version", "recipient_user_id", "outcome_note", "outcome_by_user_id", "outcome_at", "created_at", "updated_at" FROM public."community_awards" AS source WHERE EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = source.season_id AND s.status <> 'draft') AND source.status IN ('approved', 'awarded', 'not_awarded', 'cancelled')
      ) AS mirror_row;
    WHEN 'community_groups' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "id", "season_id", "label", "audience", "group_number", "qr_image_path", "join_url", "note", "status", "sort_order", "created_at", "updated_at" FROM public."community_groups" AS source WHERE EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = source.season_id AND s.status <> 'draft')
      ) AS mirror_row;
    WHEN 'competition_entries' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "id", "competition_id", "source", "team_id", "source_registration_id", "formation_order", "name", "logo_url", "representative_user_id", "registration_status", "perfect_team_id", "current_roster_revision_id", "approved_roster_revision_id", "submitted_at", "reviewed_at", "created_at", "updated_at" FROM public."competition_entries" AS source WHERE EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = source.competition_id AND s.status <> 'draft')
      ) AS mirror_row;
    WHEN 'competition_entry_active_claims' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "competition_id", "user_id", "entry_id", "participant_id", "created_at" FROM public."competition_entry_active_claims" AS source WHERE EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = source.competition_id AND s.status <> 'draft')
      ) AS mirror_row;
    WHEN 'competition_entry_participants' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "id", "entry_id", "user_id", "status", "invited_by_user_id", "confirmed_at", "withdrawn_at", "created_at", "updated_at" FROM public."competition_entry_participants" AS source WHERE EXISTS (SELECT 1 FROM public.competition_entries e WHERE e.id = source.entry_id AND EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = e.competition_id AND s.status <> 'draft'))
      ) AS mirror_row;
    WHEN 'competition_entry_representative_changes' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "id", "entry_id", "from_user_id", "to_user_id", "changed_at", "changed_by_actor_id" FROM public."competition_entry_representative_changes" AS source WHERE EXISTS (SELECT 1 FROM public.competition_entries e WHERE e.id = source.entry_id AND EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = e.competition_id AND s.status <> 'draft'))
      ) AS mirror_row;
    WHEN 'competition_entry_roster_members' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "id", "revision_id", "participant_id", "user_id", "team_membership_id", "is_primary_starter", "created_at" FROM public."competition_entry_roster_members" AS source WHERE EXISTS (SELECT 1 FROM public.competition_entry_roster_revisions r WHERE r.id = source.revision_id AND EXISTS (SELECT 1 FROM public.competition_entries e WHERE e.id = r.entry_id AND EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = e.competition_id AND s.status <> 'draft')))
      ) AS mirror_row;
    WHEN 'competition_entry_roster_revisions' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "id", "entry_id", "revision_number", "status", "origin", "created_by", "created_at", "submitted_at", "approved_at" FROM public."competition_entry_roster_revisions" AS source WHERE EXISTS (SELECT 1 FROM public.competition_entries e WHERE e.id = source.entry_id AND EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = e.competition_id AND s.status <> 'draft'))
      ) AS mirror_row;
    WHEN 'competition_entry_submissions' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "id", "entry_id", "roster_revision_id", "sequence", "decision", "submitted_by", "submitted_at", "decided_by", "decided_at" FROM public."competition_entry_submissions" AS source WHERE EXISTS (SELECT 1 FROM public.competition_entries e WHERE e.id = source.entry_id AND EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = e.competition_id AND s.status <> 'draft'))
      ) AS mirror_row;
    WHEN 'competition_qualification_drafts' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "season_id", "order", "format", "target_entrant_count", "version", "updated_at", 'preview:redacted'::text AS updated_by FROM public."competition_qualification_drafts" AS source WHERE EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = source.season_id AND s.status <> 'draft')
      ) AS mirror_row;
    WHEN 'competition_qualification_entrants' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "id", "run_id", "season_id", "competition_entry_id", "preliminary_seed", "created_at" FROM public."competition_qualification_entrants" AS source WHERE EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = source.season_id AND s.status <> 'draft')
      ) AS mirror_row;
    WHEN 'competition_qualification_runs' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "id", "season_id", "format", "target_entrant_count", "candidate_count", "direct_entry_count", "play_in_entry_count", "qualifier_count", "configured_at", "started_at", "completed_at", "created_at", "updated_at", 'preview:redacted'::text AS configured_by, CASE WHEN "started_at" IS NULL THEN NULL ELSE 'preview:redacted'::text END AS started_by FROM public."competition_qualification_runs" AS source WHERE EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = source.season_id AND s.status <> 'draft')
      ) AS mirror_row;
    WHEN 'competition_stage_bracket_states' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "competition_id", "stage_key", "data", "updated_at" FROM public."competition_stage_bracket_states" AS source WHERE EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = source.competition_id AND s.status <> 'draft')
      ) AS mirror_row;
    WHEN 'competitive_platform_ranks' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "id", "platform_key", "rank_key", "label", "sort_order", "star_min", "star_max", "created_at", "updated_at" FROM public."competitive_platform_ranks" AS source
      ) AS mirror_row;
    WHEN 'competitive_platform_seasons' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "id", "platform", "season_key", "label", "active", "sort_order", "is_current", "created_at", "updated_at" FROM public."competitive_platform_seasons" AS source
      ) AS mirror_row;
    WHEN 'competitive_platforms' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "key", "display_name", "rating_label", "created_at", "updated_at" FROM public."competitive_platforms" AS source
      ) AS mirror_row;
    WHEN 'competitive_rank_facts' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "id", "user_id", "platform", "kind", "platform_season_key", "status", "rank", "rating", "stars", "achieved_season_key", "provenance", "declared_at", "updated_at" FROM public."competitive_rank_facts" AS source
      ) AS mirror_row;
    WHEN 'dak_pairing_intents' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "id", 'preview:' || id::text AS poll_token_hash, 'expired' AS status, NULL AS "authorized_by_user_id", "expires_at", NULL AS "authorized_at", NULL AS "delivered_at", "created_at" FROM public."dak_pairing_intents" AS source WHERE EXISTS (SELECT 1 FROM public.dak_pairings p JOIN public.match_demo_imports d ON d.submitted_by_pairing_id = p.id WHERE p.pairing_intent_id = source.id AND EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = d.season_id AND s.status <> 'draft'))
      ) AS mirror_row;
    WHEN 'dak_pairings' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "id", "pairing_intent_id", "user_id", 'preview:' || id::text AS token_hash, ARRAY[]::text[] AS "scopes", ARRAY[]::text[] AS "season_ids", 'revoked' AS status, created_at AS revoked_at, NULL AS last_used_at, "created_at" FROM public."dak_pairings" AS source WHERE EXISTS (SELECT 1 FROM public.match_demo_imports d WHERE d.submitted_by_pairing_id = source.id AND EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = d.season_id AND s.status <> 'draft'))
      ) AS mirror_row;
    WHEN 'disciplinary_cases' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "id", "season_id", "subject_user_id", "status", "effects", "public_explanation", "effective_from", "effective_until", "revoked_at", "created_at", "updated_at", 'preview:redacted'::text AS issued_by FROM public."disciplinary_cases" AS source WHERE EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = source.season_id AND s.status <> 'draft') AND source.status <> 'draft' AND source.effective_from <= now()
      ) AS mirror_row;
    WHEN 'draft_picks' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "id", "season_id", "entry_id", "registration_id", "round", "pick_number", "auto_picked", "created_at" FROM public."draft_picks" AS source WHERE EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = source.season_id AND s.status <> 'draft')
      ) AS mirror_row;
    WHEN 'draft_state' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "id", "season_id", "current_round", "current_entry_id", "round_deadline", "is_active", "updated_at" FROM public."draft_state" AS source WHERE EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = source.season_id AND s.status <> 'draft')
      ) AS mirror_row;
    WHEN 'education_verifications' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "id", "user_id", "institution_id", "academic_status", "evidence_type", "status", "submitted_at", "reviewed_at", "created_at", "updated_at" FROM public."education_verifications" AS source WHERE false
      ) AS mirror_row;
    WHEN 'event_roster_members' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "id", "event_roster_id", "user_id", "participant_id", NULL AS education_verification_id, "is_primary_starter", "is_current", "created_at" FROM public."event_roster_members" AS source WHERE EXISTS (SELECT 1 FROM public.event_rosters r WHERE r.id = source.event_roster_id AND EXISTS (SELECT 1 FROM public.competition_entries e WHERE e.id = r.entry_id AND EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = e.competition_id AND s.status <> 'draft')))
      ) AS mirror_row;
    WHEN 'event_rosters' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "id", "entry_id", "source_roster_revision_id", "status", "confirmed_at", "confirmed_by", "frozen_at", "frozen_by", "created_at", "updated_at" FROM public."event_rosters" AS source WHERE EXISTS (SELECT 1 FROM public.competition_entries e WHERE e.id = source.entry_id AND EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = e.competition_id AND s.status <> 'draft'))
      ) AS mirror_row;
    WHEN 'institutions' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "id", "moe_institution_code", "name", "province", "education_level", "category", "source", "source_version", "created_at", "updated_at" FROM public."institutions" AS source
      ) AS mirror_row;
    WHEN 'major_final_results' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "id", "season_id", "playoff_stage_run_id", "champion_entry_id", "placement_groups", "status", "finalized_at", "finalized_by", "confirmed_at", "confirmed_by" FROM public."major_final_results" AS source WHERE EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = source.season_id AND s.status <> 'draft')
      ) AS mirror_row;
    WHEN 'major_prestart_states' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "id", "season_id", "entrants_locked_at", "entrants_locked_by", "seeds_confirmed_at", "seeds_confirmed_by", "seeds_locked_at", "seeds_locked_by", "main_event_planned_start_at", "created_at", "updated_at" FROM public."major_prestart_states" AS source WHERE EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = source.season_id AND s.status <> 'draft')
      ) AS mirror_row;
    WHEN 'major_stage_entrants' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "id", "stage_run_id", "season_id", "tournament_entrant_id", "stage_seed", "created_at" FROM public."major_stage_entrants" AS source WHERE EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = source.season_id AND s.status <> 'draft')
      ) AS mirror_row;
    WHEN 'major_stage_runs' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "id", "season_id", "stage_key", "rule_snapshot", "finalized_round", "started_at", "started_by" FROM public."major_stage_runs" AS source WHERE EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = source.season_id AND s.status <> 'draft')
      ) AS mirror_row;
    WHEN 'major_tournament_entrants' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "id", "season_id", "competition_entry_id", "created_at" FROM public."major_tournament_entrants" AS source WHERE EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = source.season_id AND s.status <> 'draft')
      ) AS mirror_row;
    WHEN 'major_tournament_seeds' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "id", "season_id", "tournament_entrant_id", "seed", "created_at" FROM public."major_tournament_seeds" AS source WHERE EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = source.season_id AND s.status <> 'draft')
      ) AS mirror_row;
    WHEN 'match_commentators' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "match_id", "user_id", "added_by_user_id", "added_at" FROM public."match_commentators" AS source WHERE EXISTS (SELECT 1 FROM public.matches m WHERE m.id = source.match_id AND EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = m.season_id AND s.status <> 'draft'))
      ) AS mirror_row;
    WHEN 'match_demo_imports' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "id", "season_id", "match_id", "match_map_id", "stage_key", "stage_run_id", "demo_sha256", "payload_sha256", "contract_version", "semantic_profile", "analysis_version", "evidence_revision", "validated_revision", "status", "payload", "submitted_by_pairing_id", "idempotency_key", "supersedes_import_id", "issues", "submitted_at", "confirmed_at", "created_at" FROM public."match_demo_imports" AS source WHERE EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = source.season_id AND s.status <> 'draft') AND EXISTS (SELECT 1 FROM public.matches m WHERE m.id = source.match_id AND EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = m.season_id AND s.status <> 'draft'))
      ) AS mirror_row;
    WHEN 'match_demo_stat_projections' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "import_id", "projection_version", "payload_sha256", "demo_sha256", "semantic_profile", "analysis_version", "evidence_revision", "identity_bindings", "facts", "created_at" FROM public."match_demo_stat_projections" AS source WHERE EXISTS (SELECT 1 FROM public.match_demo_imports d WHERE d.id = source.import_id AND EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = d.season_id AND s.status <> 'draft'))
      ) AS mirror_row;
    WHEN 'match_maps' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "id", "match_id", "map_order", "map_name", "picked_by_entry_id", "team_a_start_side", "score_a", "score_b", "started_at", "completed_at", "created_at" FROM public."match_maps" AS source WHERE EXISTS (SELECT 1 FROM public.matches m WHERE m.id = source.match_id AND EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = m.season_id AND s.status <> 'draft'))
      ) AS mirror_row;
    WHEN 'match_player_stats' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "id", "match_id", "map_id", "perfect_name", "user_id", "kills", "deaths", "assists", "hs_percent", "first_kills", "first_deaths", "multi_kills", "trade_kills", "kast_rounds", "clutches", "adr", "rws", "rating_pro", "we", "dak_import_id", "verified_by_admin", "verified_at", "created_at" FROM public."match_player_stats" AS source WHERE EXISTS (SELECT 1 FROM public.matches m WHERE m.id = source.match_id AND EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = m.season_id AND s.status <> 'draft'))
      ) AS mirror_row;
    WHEN 'match_roster_players' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "roster_id", "event_roster_member_id", "is_starter", "is_veto_representative" FROM public."match_roster_players" AS source WHERE EXISTS (SELECT 1 FROM public.match_rosters r WHERE r.id = source.roster_id AND EXISTS (SELECT 1 FROM public.matches m WHERE m.id = r.match_id AND EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = m.season_id AND s.status <> 'draft')))
      ) AS mirror_row;
    WHEN 'match_rosters' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "id", "match_id", "entry_id", "submitted_by", "source", "status", "locked_at", "confirmed_at", "confirmed_by", "created_at", "updated_at" FROM public."match_rosters" AS source WHERE EXISTS (SELECT 1 FROM public.matches m WHERE m.id = source.match_id AND EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = m.season_id AND s.status <> 'draft'))
      ) AS mirror_row;
    WHEN 'match_round_facts' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "id", "import_id", "round_seq", "source_round_number", "phase", "start_tick", "freeze_end_tick", "end_tick", "team_a_side", "team_b_side", "team_a_score_before", "team_b_score_before", "team_a_economy", "team_b_economy", "winner_team_key", "winner_side", "end_reason", "created_at" FROM public."match_round_facts" AS source WHERE EXISTS (SELECT 1 FROM public.match_demo_imports d WHERE d.id = source.import_id AND EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = d.season_id AND s.status <> 'draft'))
      ) AS mirror_row;
    WHEN 'match_veto_appeals' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "id", "timeout_incident_id", "submitted_by", "status", "resolution_scope", "resolved_by", "created_at", "resolved_at", '预览已脱敏' AS reason FROM public."match_veto_appeals" AS source WHERE EXISTS (SELECT 1 FROM public.match_veto_timeout_incidents i WHERE i.id = source.timeout_incident_id AND EXISTS (SELECT 1 FROM public.matches m WHERE m.id = i.match_id AND EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = m.season_id AND s.status <> 'draft')))
      ) AS mirror_row;
    WHEN 'match_veto_sessions' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "match_id", "privileged_entry_id", "veto_team_a_entry_id", "entry_a_start_requested_at", "entry_a_start_requested_by", "entry_b_start_requested_at", "entry_b_start_requested_by", "map_pool_snapshot", "started_at", "completed_at", "current_turn_key", "turn_started_at", "turn_deadline_at", "paused_at", "paused_by", "revision", "created_at", "updated_at" FROM public."match_veto_sessions" AS source WHERE EXISTS (SELECT 1 FROM public.matches m WHERE m.id = source.match_id AND EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = m.season_id AND s.status <> 'draft'))
      ) AS mirror_row;
    WHEN 'match_veto_steps' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "id", "match_id", "step_order", "action_type", "map_name", "entry_id", "side", "source", "actor_user_id", "turn_key", "created_at" FROM public."match_veto_steps" AS source WHERE EXISTS (SELECT 1 FROM public.matches m WHERE m.id = source.match_id AND EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = m.season_id AND s.status <> 'draft'))
      ) AS mirror_row;
    WHEN 'match_veto_timeout_incidents' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "id", "match_id", "turn_key", "entry_id", "representative_user_id", "deadline_at", "resolved_at", "eligible_options", "selected_options", "created_at" FROM public."match_veto_timeout_incidents" AS source WHERE EXISTS (SELECT 1 FROM public.matches m WHERE m.id = source.match_id AND EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = m.season_id AND s.status <> 'draft'))
      ) AS mirror_row;
    WHEN 'matches' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "id", "season_id", "entry_a_id", "entry_b_id", CASE WHEN execution_context IS NULL THEN NULL ELSE jsonb_build_object(
      'version', 1, 'sides', jsonb_build_object(
        'a', jsonb_build_object('name', 'Preview A', 'logoUrl', NULL),
        'b', jsonb_build_object('name', 'Preview B', 'logoUrl', NULL)
      ), 'mapPool', execution_context->'mapPool'
    ) END AS execution_context, "result_disposition", CASE WHEN test_config IS NULL THEN NULL ELSE jsonb_build_object(
      'mapPool', test_config->'mapPool',
      'operatorAId', test_config->'operatorAId', 'operatorBId', test_config->'operatorBId'
    ) END AS test_config, "stage", "round", "format", "entry_round", "score_a", "score_b", "status", "is_forfeit", "bracket_node_id", "ownership", "major_stage_run_id", "qualification_run_id", "managed_key", "scheduled_at", "started_at", "gameplay_started_at", "completion_deadline", "completed_at", "mvp_winner_user_id", "created_at", "updated_at" FROM public."matches" AS source WHERE EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = source.season_id AND s.status <> 'draft')
      ) AS mirror_row;
    WHEN 'post_event_adjudications' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "id", "season_id", "status", "kind", "target", "impacts", "target_entry_id", "target_user_id", "target_match_id", "public_explanation", "created_by", "created_at", "revoked_by", "revoked_at", id AS client_request_id, '预览已脱敏' AS reason FROM public."post_event_adjudications" AS source WHERE EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = source.season_id AND s.status <> 'draft')
      ) AS mirror_row;
    WHEN 'post_match_reports' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "match_id", "submitted_by_user_id", "submitted_at" FROM public."post_match_reports" AS source WHERE EXISTS (SELECT 1 FROM public.matches m WHERE m.id = source.match_id AND EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = m.season_id AND s.status <> 'draft'))
      ) AS mirror_row;
    WHEN 'recruitment_intents' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "id", "kind", "team_id", "user_id", "positions", "target_season_id", "status", "expires_at", "created_at", "updated_at" FROM public."recruitment_intents" AS source WHERE (source.target_season_id IS NULL OR EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = source.target_season_id AND s.status <> 'draft'))
      ) AS mirror_row;
    WHEN 'season_contacts' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "id", "season_id", "label", "public_name", "value", "href", "note", "sort_order", "created_at", "updated_at" FROM public."season_contacts" AS source WHERE EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = source.season_id AND s.status <> 'draft')
      ) AS mirror_row;
    WHEN 'season_public_info' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "id", "season_id", "rules_label", "rules_href", "created_at", "updated_at" FROM public."season_public_info" AS source WHERE EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = source.season_id AND s.status <> 'draft')
      ) AS mirror_row;
    WHEN 'season_registrations' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "id", "user_id", "season_id", "player_type", "primary_position", "secondary_position", "peak_rank", "peak_rank_season", "peak_rating", "peak_we", "current_season_peak_rank", "current_rating", "current_we", "map_preferences", "gameplay_style", "competition_history", "status", "willing_to_be_captain", "created_at", "updated_at", ARRAY[]::text[] AS screenshot_urls FROM public."season_registrations" AS source WHERE EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = source.season_id AND s.status <> 'draft')
      ) AS mirror_row;
    WHEN 'seasons' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "id", "slug", "name", "kind", "competition_template", "status", "theme_color", "registration_mode", "has_captain_voting", "has_draft", "has_community_awards", "stage_plan", "registration_config", "team_registration_config", "affiliation_rules", "min_team_size", "max_team_size", "starter_count", "positions", "registration_opens_at", "registration_opened_at", "registration_closes_at", "roster_change_closes_at", "end_at", "created_at", "updated_at" FROM public."seasons" AS source WHERE source.status <> 'draft'
      ) AS mirror_row;
    WHEN 'steam_profiles' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "steam64", "persona_name", "profile_url", "avatar_url", "fetched_at" FROM public."steam_profiles" AS source
      ) AS mirror_row;
    WHEN 'team_captain_changes' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "id", "team_id", "from_user_id", "to_user_id", "changed_at", "changed_by_actor_id" FROM public."team_captain_changes" AS source
      ) AS mirror_row;
    WHEN 'team_memberships' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "id", "team_id", "user_id", "status", "started_at", "ended_at", "invited_by_user_id", "created_at", "updated_at", CASE WHEN "ended_at" IS NOT NULL THEN 'left'::public.team_membership_end_reason ELSE NULL END AS ended_reason FROM public."team_memberships" AS source
      ) AS mirror_row;
    WHEN 'team_name_changes' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "id", "team_id", "old_name", "new_name", "changed_at", "changed_by_actor_id" FROM public."team_name_changes" AS source
      ) AS mirror_row;
    WHEN 'team_slug_aliases' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "slug", "team_id", "created_at" FROM public."team_slug_aliases" AS source
      ) AS mirror_row;
    WHEN 'teams' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "id", "slug", "name", "logo_url", "description", "status", "creator_user_id", "captain_user_id", "created_at", "updated_at", "disbanded_at", "disbanded_by" FROM public."teams" AS source
      ) AS mirror_row;
    WHEN 'tournament_honors' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "id", "season_id", "honor_key", "type", "label", "state", "basis", "placement_from", "placement_to", "entry_id", "user_id", "source_final_result_id", "adjudication_id", "awarded_by", "awarded_at", "revoked_by", "revoked_at", "created_at", "updated_at", id AS client_request_id FROM public."tournament_honors" AS source WHERE EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = source.season_id AND s.status <> 'draft')
      ) AS mirror_row;
    WHEN 'user_competitive_roles' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "id", "user_id", "role", "is_primary", "created_at", "updated_at" FROM public."user_competitive_roles" AS source
      ) AS mirror_row;
    WHEN 'user_gameplay_steam_ids' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "id", "user_id", "steam64", "status", "provenance", CASE WHEN EXISTS (SELECT 1 FROM public.match_demo_imports d WHERE d.id = source.source_import_id AND EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = d.season_id AND s.status <> 'draft')) THEN source.source_import_id END AS source_import_id, "confirmed_by_user_id", "confirmed_at", "reason", "retired_by_user_id", "retired_at", "retired_reason", "created_at" FROM public."user_gameplay_steam_ids" AS source
      ) AS mirror_row;
    WHEN 'user_map_preferences' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "user_id", "map_preferences", "updated_at" FROM public."user_map_preferences" AS source
      ) AS mirror_row;
    WHEN 'users' THEN
      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (
        SELECT "id", "status", "merged_into_user_id", "merged_at", "perfect_name", "display_name", "steam64", "gameplay_style", "competition_history", "created_at", "updated_at", id::text || '@preview.invalid' AS email, 'user' AS role FROM public."users" AS source
      ) AS mirror_row;
    ELSE RAISE EXCEPTION 'Unsupported Preview export table' USING ERRCODE = '22023';
  END CASE;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION rivalhub_preview.export_table(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION rivalhub_preview.export_table(text) TO rivalhub_preview_exporter;
