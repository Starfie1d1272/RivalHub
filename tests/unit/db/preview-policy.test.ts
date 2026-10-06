import { describe, expect, it } from "vitest";
import { readExpectedMigrations } from "../../../scripts/db/production-preflight";
import {
  assertReviewedColumns,
  exportQuery,
  OMITTED_COLUMNS,
  EXCLUDED_TABLES,
  PREVIEW_COLUMNS,
  previewPolicyFor,
} from "../../../scripts/db/preview/policy";

describe("sanitized mirror policy", () => {
  it("keeps public community and Team recruitment information while excluding private interest records", () => {
    expect(PREVIEW_COLUMNS.community_groups).toContain("join_url");
    expect(PREVIEW_COLUMNS.season_contacts).toContain("value");
    expect(PREVIEW_COLUMNS.recruitment_intents).toContain("team_id");
    expect(() => assertReviewedColumns("community_groups", PREVIEW_COLUMNS.community_groups.split(" "))).not.toThrow();
    expect(exportQuery("users")).not.toContain("auth_id");
    expect(exportQuery("users")).toContain("@preview.invalid");
  });

  it("excludes prediction submissions, balances and dependent program rows from sanitized mirrors", () => {
    for (const table of ["prediction_programs", "prediction_accounts", "prediction_contests", "prediction_picks", "prediction_judgements", "prediction_scenarios", "prediction_markets", "prediction_market_options", "prediction_stakes", "prediction_settlements", "prediction_ledger", "prediction_jobs", "prediction_stage_milestones"]) {
      expect(EXCLUDED_TABLES.has(table)).toBe(true);
      expect(PREVIEW_COLUMNS).not.toHaveProperty(table);
    }
  });

  it("projects a fixed end reason without selecting the private source field", () => {
    const query = exportQuery("team_memberships");

    expect(query).toContain(`CASE WHEN "ended_at" IS NOT NULL THEN 'left'::team_membership_end_reason ELSE NULL END AS ended_reason`);
    expect(query).not.toContain('"ended_reason"');
    expect(PREVIEW_COLUMNS.team_memberships).not.toContain("ended_reason");
    expect(OMITTED_COLUMNS.team_memberships).toBe("ended_reason");
  });

  it("fails closed on an unknown source column or unreviewed table", () => {
    expect(() => assertReviewedColumns("community_groups", [...PREVIEW_COLUMNS.community_groups.split(" "), "invite_token"])).toThrow();
    expect(() => assertReviewedColumns("private_unknown", ["id"])).toThrow();
  });

  it("derives the source-compatible table and column policy from the migration ledger", () => {
    const expected = readExpectedMigrations();
    const steamProfileMigrationIndex = expected.findIndex(({ tag }) => tag === "0052_gray_supernaut");
    const statsExpansionMigrationIndex = expected.findIndex(({ tag }) => tag === "0051_sour_grim_reaper");
    expect(steamProfileMigrationIndex).toBeGreaterThan(0);
    expect(statsExpansionMigrationIndex).toBeGreaterThan(0);
    const beforeSteamProfile = expected.slice(0, steamProfileMigrationIndex).map(({ hash, when }) => ({ hash, when }));
    const beforeStatsExpansion = expected.slice(0, statsExpansionMigrationIndex).map(({ hash, when }) => ({ hash, when }));

    const lagging = previewPolicyFor(beforeSteamProfile);
    const older = previewPolicyFor(beforeStatsExpansion);

    expect(lagging.tables).not.toHaveProperty("steam_profiles");
    expect(lagging.futureTables).toContain("steam_profiles");
    expect(() => assertReviewedColumns("steam_profiles", ["id"], lagging)).toThrow(/outside the active source policy/);
    expect(older.futureColumns.match_player_stats).toEqual(expect.arrayContaining(["first_deaths", "trade_kills", "kast_rounds", "dak_import_id"]));
    expect(older.tables.match_player_stats.exportedColumns).not.toContain("first_deaths");
  });

  it("mirrors the real DAK lineage substrate for stats preview acceptance", () => {
    const policy = previewPolicyFor(readExpectedMigrations());
    expect(policy.tables.dak_pairing_intents.exportedColumns).toContain("poll_token_hash");
    expect(policy.tables.dak_pairings.exportedColumns).toContain("token_hash");
    expect(policy.tables.match_demo_imports.exportedColumns).toContain("payload");
    expect(policy.tables.match_round_facts.exportedColumns).toContain("team_a_economy");
    expect(policy.tables.user_gameplay_steam_ids.exportedColumns).toContain("steam64");
    expect(policy.tables.match_player_stats.exportedColumns).toContain("dak_import_id");
  });

  it("copies stored statistics projections only after their source migration without rereading Evidence", () => {
    const expected = readExpectedMigrations();
    const projectionIndex = expected.findIndex(({ tag }) => tag === "0067_chief_midnight");
    expect(projectionIndex).toBeGreaterThan(0);
    const beforeProjection = previewPolicyFor(expected.slice(0, projectionIndex));
    expect(beforeProjection.tables).not.toHaveProperty("match_demo_stat_projections");
    expect(beforeProjection.futureTables).toContain("match_demo_stat_projections");
    expect(() => exportQuery("match_demo_stat_projections", beforeProjection)).toThrow(/not permitted/);

    const current = previewPolicyFor(expected);
    const columns = ["import_id", "projection_version", "payload_sha256", "demo_sha256", "semantic_profile", "analysis_version", "evidence_revision", "identity_bindings", "facts", "created_at"];
    expect(current.tables.match_demo_stat_projections.exportedColumns).toEqual(columns);
    expect(() => assertReviewedColumns("match_demo_stat_projections", columns, current)).not.toThrow();
    expect(() => assertReviewedColumns("match_demo_stat_projections", [...columns, "payload"], current)).toThrow(/unreviewed column/);
    expect(exportQuery("match_demo_stat_projections", current)).toBe(
      `SELECT ${columns.map((column) => `"${column}"`).join(", ")} FROM public."match_demo_stat_projections"`,
    );
  });

  it("mirrors only public qualification facts and withholds actor identifiers", () => {
    const expected = readExpectedMigrations();
    const qualificationIndex = expected.findIndex(({ tag }) => tag === "0056_competition-qualification-playin");
    expect(qualificationIndex).toBeGreaterThan(0);

    const current = previewPolicyFor(expected);
    const beforeQualification = previewPolicyFor(expected.slice(0, qualificationIndex));

    expect(current.tables.competition_qualification_runs.exportedColumns).toContain("qualifier_count");
    expect(current.tables.competition_qualification_runs.omittedColumns).toEqual(["configured_by", "started_by", "eligibility_policy"]);
    expect(current.tables.competition_qualification_entrants.exportedColumns).toContain("preliminary_seed");
    expect(current.tables.matches.exportedColumns).toContain("qualification_run_id");
    expect(beforeQualification.tables).not.toHaveProperty("competition_qualification_runs");
    expect(beforeQualification.futureTables).toContain("competition_qualification_runs");
    expect(beforeQualification.tables.matches.exportedColumns).not.toContain("qualification_run_id");
    expect(beforeQualification.futureColumns.matches).toContain("qualification_run_id");
    expect(exportQuery("competition_qualification_runs")).not.toContain('"configured_by"');
  });

  it("exports roster currentness only for sources with the history migration", () => {
    const expected = readExpectedMigrations();
    const historyIndex = expected.findIndex(({ tag }) => tag === "0057_event_roster_member_history");
    expect(historyIndex).toBeGreaterThan(0);

    const current = previewPolicyFor(expected);
    const beforeHistory = previewPolicyFor(expected.slice(0, historyIndex));

    expect(current.tables.event_roster_members.exportedColumns).toContain("is_current");
    expect(beforeHistory.tables.event_roster_members.exportedColumns).not.toContain("is_current");
    expect(beforeHistory.futureColumns.event_roster_members).toContain("is_current");
  });

  it("allows Steam compatibility shadows before cleanup and rejects them after the real migration", () => {
    const expected = readExpectedMigrations();
    const cleanupIndex = expected.findIndex(({ tag }) => tag === "0055_steam_profile_shadow_cleanup");
    expect(cleanupIndex).toBeGreaterThan(0);
    const beforeCleanup = previewPolicyFor(expected.slice(0, cleanupIndex));
    const afterCleanup = previewPolicyFor(expected);
    const shadowColumns = ["steam_name", "steam_profile_url", "avatar_url"];
    expect(OMITTED_COLUMNS.users).not.toMatch(/steam_name|steam_profile_url|avatar_url/);
    const physicalUsersWithShadow = [
      ...PREVIEW_COLUMNS.users.split(" "),
      ...OMITTED_COLUMNS.users.split(" "),
      ...shadowColumns,
    ];

    expect(exportQuery("users")).not.toContain("steam_name");
    expect(exportQuery("users")).not.toContain("steam_profile_url");
    expect(exportQuery("users")).not.toContain("avatar_url");

    expect(beforeCleanup.tables.users.omittedColumns).toEqual(expect.arrayContaining(shadowColumns));
    expect(beforeCleanup.tables.users.removedColumns).toEqual([]);
    expect(() => assertReviewedColumns("users", physicalUsersWithShadow, beforeCleanup)).not.toThrow();

    expect(afterCleanup.tables.users.omittedColumns).not.toEqual(expect.arrayContaining(shadowColumns));
    expect(afterCleanup.tables.users.removedColumns).toEqual(expect.arrayContaining(shadowColumns));
    expect(() => assertReviewedColumns("users", physicalUsersWithShadow, afterCleanup)).toThrow(/removed mirror column/);

    const cleanedUsers = [...PREVIEW_COLUMNS.users.split(" "), ...OMITTED_COLUMNS.users.split(" ")];
    expect(() => assertReviewedColumns("users", cleanedUsers, afterCleanup)).not.toThrow();
    expect(() => assertReviewedColumns("users", [...cleanedUsers, "unreviewed_column"], afterCleanup)).toThrow(/unreviewed column/);
  });
});
