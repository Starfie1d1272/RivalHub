import { assertActiveChainPrefix, readExpectedMigrations, type ExpectedMigration, type Migration } from "../production-preflight";
import { PreviewMirrorError } from "./diagnostics";

/** Reviewed export projections. No SELECT *, Auth rows, opaque dump or private bucket. */
export const PREVIEW_COLUMNS: Record<string, string> = {
  users: "id status merged_into_user_id merged_at perfect_name display_name steam64 gameplay_style competition_history created_at updated_at",
  steam_profiles: "steam64 persona_name profile_url avatar_url fetched_at",
  institutions: "id moe_institution_code name province education_level category source source_version created_at updated_at",
  education_verifications: "id user_id institution_id academic_status evidence_type status submitted_at reviewed_at created_at updated_at",
  competitive_platforms: "key display_name rating_label created_at updated_at",
  competitive_platform_seasons: "id platform season_key label active sort_order is_current created_at updated_at",
  competitive_platform_ranks: "id platform_key rank_key label sort_order star_min star_max created_at updated_at",
  competitive_rank_facts: "id user_id platform kind platform_season_key status rank rating stars achieved_season_key provenance declared_at updated_at",
  user_competitive_roles: "id user_id role is_primary created_at updated_at",
  user_map_preferences: "user_id map_preferences updated_at",
  seasons: "id slug name kind competition_template status theme_color registration_mode has_captain_voting has_draft has_community_awards stage_plan registration_config team_registration_config affiliation_rules min_team_size max_team_size starter_count positions registration_opens_at registration_opened_at registration_closes_at roster_change_closes_at end_at created_at updated_at",
  season_registrations: "id user_id season_id player_type primary_position secondary_position peak_rank peak_rank_season peak_rating peak_we current_season_peak_rank current_rating current_we map_preferences gameplay_style competition_history status willing_to_be_captain created_at updated_at",
  teams: "id slug name logo_url description status creator_user_id captain_user_id created_at updated_at disbanded_at disbanded_by",
  team_memberships: "id team_id user_id status started_at ended_at invited_by_user_id created_at updated_at",
  team_slug_aliases: "slug team_id created_at",
  team_name_changes: "id team_id old_name new_name changed_at changed_by_actor_id",
  team_captain_changes: "id team_id from_user_id to_user_id changed_at changed_by_actor_id",
  recruitment_intents: "id kind team_id user_id positions target_season_id status expires_at created_at updated_at",
  competition_entries: "id competition_id source team_id source_registration_id formation_order name logo_url representative_user_id registration_status perfect_team_id current_roster_revision_id approved_roster_revision_id submitted_at reviewed_at created_at updated_at",
  competition_entry_participants: "id entry_id user_id status invited_by_user_id confirmed_at withdrawn_at created_at updated_at",
  competition_entry_active_claims: "competition_id user_id entry_id participant_id created_at",
  competition_entry_roster_members: "id revision_id participant_id user_id team_membership_id is_primary_starter created_at",
  competition_entry_roster_revisions: "id entry_id revision_number status origin created_by created_at submitted_at approved_at",
  competition_entry_submissions: "id entry_id roster_revision_id sequence decision submitted_by submitted_at decided_by decided_at",
  competition_entry_representative_changes: "id entry_id from_user_id to_user_id changed_at changed_by_actor_id",
  event_rosters: "id entry_id source_roster_revision_id status confirmed_at confirmed_by frozen_at frozen_by created_at updated_at",
  event_roster_members: "id event_roster_id user_id participant_id education_verification_id is_primary_starter created_at",
  major_prestart_states: "id season_id entrants_locked_at entrants_locked_by seeds_confirmed_at seeds_confirmed_by seeds_locked_at seeds_locked_by created_at updated_at",
  major_tournament_entrants: "id season_id competition_entry_id created_at",
  major_tournament_seeds: "id season_id tournament_entrant_id seed created_at",
  major_stage_runs: "id season_id stage_key rule_snapshot finalized_round started_at started_by",
  major_stage_entrants: "id stage_run_id season_id tournament_entrant_id stage_seed created_at",
  major_final_results: "id season_id playoff_stage_run_id champion_entry_id placement_groups status finalized_at finalized_by confirmed_at confirmed_by",
  captain_votes: "id voter_registration_id candidate_registration_id created_at",
  draft_picks: "id season_id entry_id registration_id round pick_number auto_picked created_at",
  draft_state: "id season_id current_round current_entry_id round_deadline is_active updated_at",
  dak_pairing_intents: "id poll_token_hash status authorized_by_user_id expires_at authorized_at delivered_at created_at",
  dak_pairings: "id pairing_intent_id user_id token_hash scopes season_ids status revoked_at last_used_at created_at",
  matches: "id season_id entry_a_id entry_b_id stage round format entry_round score_a score_b status is_forfeit bracket_node_id ownership major_stage_run_id managed_key scheduled_at completion_deadline completed_at mvp_winner_user_id created_at updated_at",
  match_maps: "id match_id map_order map_name picked_by_entry_id team_a_start_side score_a score_b completed_at created_at",
  match_demo_imports: "id season_id match_id match_map_id stage_key stage_run_id demo_sha256 payload_sha256 contract_version semantic_profile analysis_version evidence_revision status payload submitted_by_pairing_id idempotency_key supersedes_import_id issues submitted_at confirmed_at created_at",
  match_player_stats: "id match_id map_id perfect_name user_id kills deaths assists hs_percent first_kills first_deaths multi_kills trade_kills kast_rounds clutches adr rws rating_pro we dak_import_id verified_by_admin verified_at created_at",
  match_round_facts: "id import_id round_seq source_round_number phase start_tick freeze_end_tick end_tick team_a_side team_b_side team_a_score_before team_b_score_before team_a_economy team_b_economy winner_team_key winner_side end_reason created_at",
  match_rosters: "id match_id entry_id submitted_by source status locked_at confirmed_at confirmed_by created_at updated_at",
  match_roster_players: "roster_id event_roster_member_id is_starter",
  match_veto_steps: "id match_id step_order action_type map_name entry_id side created_at",
  match_commentators: "match_id user_id added_by_user_id added_at",
  post_match_reports: "match_id submitted_by_user_id submitted_at",
  community_awards: "id season_id submitted_by_user_id name condition prize public_note status reviewed_by_user_id reviewed_at recipient_user_id outcome_note outcome_by_user_id outcome_at created_at updated_at",
  announcements: "id scope season_id type title body status requires_attention attention_until published_at created_by updated_by created_at updated_at",
  season_public_info: "id season_id rules_label rules_href created_at updated_at",
  community_groups: "id season_id label audience group_number qr_image_path join_url note status sort_order created_at updated_at",
  season_contacts: "id season_id label public_name value href note sort_order created_at updated_at",
  competition_stage_bracket_states: "competition_id stage_key data updated_at",
  post_event_adjudications: "id season_id status kind target impacts target_entry_id target_user_id target_match_id public_explanation created_by created_at revoked_by revoked_at",
  tournament_honors: "id season_id honor_key type label state basis placement_from placement_to entry_id user_id source_final_result_id adjudication_id awarded_by awarded_at revoked_by revoked_at created_at updated_at",
  user_gameplay_steam_ids: "id user_id steam64 status provenance source_import_id confirmed_by_user_id confirmed_at reason retired_by_user_id retired_at retired_reason created_at",
};

/** Known columns deliberately not exported. New columns require an explicit review. */
export const OMITTED_COLUMNS: Record<string, string> = {
  users: "auth_id email email_verified_at email_verification_source role student_id qq live_stream_url",
  education_verifications: "evidence_code evidence_object_key reviewed_by review_note",
  season_registrations: "screenshot_urls highlight_video_url notes",
  team_memberships: "ended_reason",
  competition_entries: "review_reason",
  competition_entry_submissions: "reason",
  major_prestart_states: "seed_override_reason",
  draft_picks: "client_request_id",
  matches: "video_url",
  community_awards: "supplementary_note review_note",
  post_event_adjudications: "client_request_id reason internal_evidence revocation_reason",
  tournament_honors: "client_request_id revocation_reason",
  recruitment_intents: "note",
};

type PreviewSchemaColumnLifecycle = {
  name: string;
  introducedAt?: string;
  removedAt?: string;
  compatibility?: "legacy-shadow";
};

type PreviewSchemaLifecycleTable = {
  table: string;
  introducedAt?: string;
  removedAt?: string;
  columns?: readonly PreviewSchemaColumnLifecycle[];
};

/**
 * Preview policy changes are keyed to the migration lifecycle that makes a
 * table/column available or removes a legacy compatibility owner. The current
 * policy remains the latest-main projection; previewPolicyFor() removes future
 * entries for a lagging source and rejects columns past their removal marker.
 */
export const PREVIEW_STEAM_SHADOW_CLEANUP_MIGRATION = "0053_steam_profile_contract_cleanup";

export const PREVIEW_SCHEMA_LIFECYCLE: readonly PreviewSchemaLifecycleTable[] = [
  { table: "dak_pairing_intents", introducedAt: "0051_sour_grim_reaper" },
  { table: "dak_pairings", introducedAt: "0051_sour_grim_reaper" },
  { table: "match_demo_imports", introducedAt: "0051_sour_grim_reaper" },
  { table: "match_round_facts", introducedAt: "0051_sour_grim_reaper" },
  {
    table: "match_player_stats",
    columns: [
      { name: "first_deaths", introducedAt: "0051_sour_grim_reaper" },
      { name: "trade_kills", introducedAt: "0051_sour_grim_reaper" },
      { name: "kast_rounds", introducedAt: "0051_sour_grim_reaper" },
      { name: "dak_import_id", introducedAt: "0051_sour_grim_reaper" },
    ],
  },
  {
    table: "steam_profiles",
    introducedAt: "0052_gray_supernaut",
  },
  { table: "user_gameplay_steam_ids", introducedAt: "0052_gray_supernaut" },
  {
    table: "users",
    columns: [
      { name: "steam_name", removedAt: PREVIEW_STEAM_SHADOW_CLEANUP_MIGRATION, compatibility: "legacy-shadow" },
      { name: "steam_profile_url", removedAt: PREVIEW_STEAM_SHADOW_CLEANUP_MIGRATION, compatibility: "legacy-shadow" },
      { name: "avatar_url", removedAt: PREVIEW_STEAM_SHADOW_CLEANUP_MIGRATION, compatibility: "legacy-shadow" },
    ],
  },
] as const;

export const EXCLUDED_TABLES = new Set(`identity_link_requests user_identities user_merge_authorizations user_merge_ledger
  institution_email_domains conversion_policies registration_drafts team_invitations recruitment_interests
  competition_entry_legacy_identities competition_entry_restriction_overrides major_prestart_issues major_seed_recommendation_snapshots
  audit_logs admin_invites admin_invite_claims season_admin_grants match_mvp_votes match_time_proposals
  user_sessions disciplinary_case_idempotency disciplinary_cases community_award_evidence
  scheduled_job_health feedback_reports`.split(/\s+/));

export interface PreviewTablePolicy {
  exportedColumns: readonly string[];
  omittedColumns: readonly string[];
  removedColumns: readonly string[];
}

export interface PreviewPolicy {
  sourceMigrations: readonly Migration[];
  sourceMigrationTags: readonly string[];
  tables: Readonly<Record<string, PreviewTablePolicy>>;
  futureTables: readonly string[];
  futureColumns: Readonly<Record<string, readonly string[]>>;
}

type PreviewPolicyInput = readonly Migration[] | PreviewPolicy;

export function previewPolicyFor(
  sourceMigrations: readonly Migration[],
  expectedMigrations: readonly ExpectedMigration[] = readExpectedMigrations(),
): PreviewPolicy {
  try {
    assertActiveChainPrefix(sourceMigrations, expectedMigrations);
  } catch (error) {
    throw new PreviewMirrorError("PREVIEW_MIGRATION_LEDGER_FAILED", "Preview source migration ledger is not an active chain prefix.", {
      cause: error,
      context: { phase: "migration ledger" },
    });
  }

  assertPolicyDefinition(expectedMigrations);
  const sourceMigrationTags = expectedMigrations.slice(0, sourceMigrations.length).map((migration) => migration.tag);
  const applied = new Set(sourceMigrationTags);
  const tables: Record<string, PreviewTablePolicy> = {};
  const futureTables: string[] = [];
  const futureColumns: Record<string, readonly string[]> = {};

  for (const [table, exported] of Object.entries(PREVIEW_COLUMNS)) {
    const tableLifecycle = PREVIEW_SCHEMA_LIFECYCLE.find((event) => event.table === table);
    if (tableLifecycle && !isLifecycleActive(tableLifecycle, applied)) {
      futureTables.push(table);
      continue;
    }

    const exportedColumns = exported.split(" ").filter((column) => isColumnAvailable(table, column, applied));
    const legacyOmittedColumns = lifecycleColumns(table)
      .filter((column) => column.compatibility === "legacy-shadow" && isLifecycleActive(column, applied))
      .map((column) => column.name);
    const omittedColumns = uniqueColumns([
      ...(OMITTED_COLUMNS[table]?.split(" ") ?? []).filter((column) => isColumnAvailable(table, column, applied)),
      ...legacyOmittedColumns,
    ]);
    const removedColumns = lifecycleColumns(table)
      .filter((column) => isLifecycleRemoved(column, applied))
      .map((column) => column.name);
    tables[table] = { exportedColumns, omittedColumns, removedColumns };

    const future = uniqueColumns([
      ...exported.split(" "),
      ...(OMITTED_COLUMNS[table]?.split(" ") ?? []),
      ...lifecycleColumns(table).map((column) => column.name),
    ]).filter((column) => isColumnFuture(table, column, applied));
    if (future.length) futureColumns[table] = future;
  }

  return {
    sourceMigrations,
    sourceMigrationTags,
    tables,
    futureTables: futureTables.sort(),
    futureColumns,
  };
}

export function quoteIdentifier(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error("Invalid mirror identifier");
  return `"${value}"`;
}

export function assertReviewedColumns(
  table: string,
  columns: readonly string[],
  source: PreviewPolicyInput = readExpectedMigrations(),
): void {
  if (EXCLUDED_TABLES.has(table)) return;
  const policy = resolvePolicy(source);
  const tablePolicy = policy.tables[table];
  if (!tablePolicy) {
    throw new PreviewMirrorError(
      Object.hasOwn(PREVIEW_COLUMNS, table) ? "FUTURE_MIRROR_TABLE" : "UNREVIEWED_MIRROR_TABLE",
      "Preview source schema contains a table outside the active source policy.",
      { context: { phase: "schema inventory-policy", table } },
    );
  }

  const actual = new Set(columns);
  const removed = [...actual].find((column) => tablePolicy.removedColumns.includes(column));
  if (removed) {
    throw new PreviewMirrorError("REMOVED_MIRROR_COLUMNS", "Preview source schema contains a removed mirror column.", {
      context: { phase: "schema inventory-policy", table, column: removed },
    });
  }
  const reviewed = new Set([...tablePolicy.exportedColumns, ...tablePolicy.omittedColumns]);
  const unknown = [...actual].find((column) => !reviewed.has(column));
  if (unknown) {
    throw new PreviewMirrorError("UNREVIEWED_MIRROR_COLUMNS", "Preview source schema contains an unreviewed column.", {
      context: { phase: "schema inventory-policy", table, column: unknown },
    });
  }

  const missingExported = tablePolicy.exportedColumns.find((column) => !actual.has(column));
  if (missingExported) {
    throw new PreviewMirrorError("MISSING_MIRROR_COLUMNS", "Preview source schema is missing an exported column.", {
      context: { phase: "schema inventory-policy", table, column: missingExported },
    });
  }
}

export function exportQuery(table: string, source: PreviewPolicyInput = readExpectedMigrations()): string {
  const policy = resolvePolicy(source);
  const tablePolicy = policy.tables[table];
  if (!tablePolicy) throw new PreviewMirrorError("FUTURE_MIRROR_TABLE", "Table is not permitted in mirror export.", { context: { table } });
  const expressions = tablePolicy.exportedColumns.map(quoteIdentifier);
  if (table === "users") expressions.push(`id::text || '@preview.invalid' AS email`, `'user' AS role`);
  if (table === "season_registrations") expressions.push(`ARRAY[]::text[] AS screenshot_urls`);
  if (table === "team_memberships") expressions.push(`CASE WHEN "ended_at" IS NOT NULL THEN 'left'::team_membership_end_reason ELSE NULL END AS ended_reason`);
  if (table === "post_event_adjudications" || table === "tournament_honors") expressions.push(`id AS client_request_id`);
  if (table === "post_event_adjudications") expressions.push(`'预览已脱敏' AS reason`);
  // Only public, final facts; pending private review evidence is not a preview seed.
  const filter = table === "education_verifications" ? " WHERE status = 'approved'"
    : table === "announcements" ? " WHERE status = 'published'"
      : table === "community_awards" ? " WHERE status IN ('approved', 'awarded', 'not_awarded', 'cancelled')" : "";
  return `SELECT ${expressions.join(", ")} FROM public.${quoteIdentifier(table)}${filter}`;
}

function resolvePolicy(source: PreviewPolicyInput): PreviewPolicy {
  return isPreviewPolicy(source) ? source : previewPolicyFor(source);
}

function isPreviewPolicy(value: PreviewPolicyInput): value is PreviewPolicy {
  return !Array.isArray(value) && typeof value === "object" && Object.hasOwn(value, "tables");
}

function isColumnAvailable(table: string, column: string, applied: ReadonlySet<string>): boolean {
  const lifecycle = lifecycleColumns(table).find((candidate) => candidate.name === column);
  return !lifecycle || isLifecycleActive(lifecycle, applied);
}

function isColumnFuture(table: string, column: string, applied: ReadonlySet<string>): boolean {
  const lifecycle = lifecycleColumns(table).find((candidate) => candidate.name === column);
  return Boolean(lifecycle?.introducedAt && !applied.has(lifecycle.introducedAt));
}

function lifecycleColumns(table: string): readonly PreviewSchemaColumnLifecycle[] {
  return PREVIEW_SCHEMA_LIFECYCLE.find((event) => event.table === table)?.columns ?? [];
}

function isLifecycleActive(
  lifecycle: PreviewSchemaLifecycleTable | PreviewSchemaColumnLifecycle,
  applied: ReadonlySet<string>,
): boolean {
  return (!lifecycle.introducedAt || applied.has(lifecycle.introducedAt))
    && (!lifecycle.removedAt || !applied.has(lifecycle.removedAt));
}

function isLifecycleRemoved(lifecycle: PreviewSchemaColumnLifecycle, applied: ReadonlySet<string>): boolean {
  return Boolean(lifecycle.removedAt && applied.has(lifecycle.removedAt));
}

function uniqueColumns(columns: readonly string[]): string[] {
  return [...new Set(columns)];
}

function assertPolicyDefinition(expectedMigrations: readonly ExpectedMigration[]): void {
  const knownMigrationIndexes = new Map(expectedMigrations.map((migration, index) => [migration.tag, index]));
  const seenColumns = new Set<string>();
  for (const event of PREVIEW_SCHEMA_LIFECYCLE) {
    if (!Object.hasOwn(PREVIEW_COLUMNS, event.table) && !EXCLUDED_TABLES.has(event.table)) {
      throw new PreviewMirrorError("PREVIEW_SCHEMA_POLICY_INVALID", "Preview schema policy references an unknown table.", {
        context: { phase: "schema inventory-policy", table: event.table },
      });
    }
    const introducedIndex = event.introducedAt ? knownMigrationIndexes.get(event.introducedAt) : undefined;
    const removedIndex = event.removedAt ? knownMigrationIndexes.get(event.removedAt) : undefined;
    if (introducedIndex !== undefined && removedIndex !== undefined && introducedIndex >= removedIndex) {
      throw new PreviewMirrorError("PREVIEW_SCHEMA_POLICY_INVALID", "Preview schema lifecycle has an invalid migration interval.", {
        context: { phase: "schema inventory-policy", table: event.table },
      });
    }
    for (const column of event.columns ?? []) {
      const key = `${event.table}.${column.name}`;
      if (seenColumns.has(key)) {
        throw new PreviewMirrorError("PREVIEW_SCHEMA_POLICY_INVALID", "Preview schema lifecycle declares a column more than once.", {
          context: { phase: "schema inventory-policy", table: event.table, column: column.name },
        });
      }
      seenColumns.add(key);
      const known = PREVIEW_COLUMNS[event.table]?.split(" ").includes(column.name) || OMITTED_COLUMNS[event.table]?.split(" ").includes(column.name);
      if (column.compatibility === "legacy-shadow") {
        if (known || !column.removedAt) {
          throw new PreviewMirrorError("PREVIEW_SCHEMA_POLICY_INVALID", "Preview legacy shadow lifecycle is not a removed compatibility column.", {
            context: { phase: "schema inventory-policy", table: event.table, column: column.name },
          });
        }
      } else if (!known) {
        throw new PreviewMirrorError("PREVIEW_SCHEMA_POLICY_INVALID", "Preview schema policy references an unknown column owner.", {
          context: { phase: "schema inventory-policy", table: event.table, column: column.name },
        });
      }
      if (column.compatibility === "legacy-shadow" && OMITTED_COLUMNS[event.table]?.split(" ").includes(column.name)) {
        throw new PreviewMirrorError("PREVIEW_SCHEMA_POLICY_INVALID", "Preview legacy shadow must not remain in permanent omitted columns.", {
          context: { phase: "schema inventory-policy", table: event.table, column: column.name },
        });
      }
    }
  }
}
