import { describe, expect, it } from "vitest";
import { readExpectedMigrations } from "../../../scripts/db/production-preflight";
import {
  assertReviewedColumns,
  exportQuery,
  OMITTED_COLUMNS,
  PREVIEW_COLUMNS,
  PREVIEW_STEAM_SHADOW_CLEANUP_MIGRATION,
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

  it("reviews retained Steam rollback shadows while allowing their later contract cleanup drop", () => {
    expect(OMITTED_COLUMNS.users).not.toMatch(/steam_name|steam_profile_url|avatar_url/);
    const physicalUsersAfterCleanup = [
      ...PREVIEW_COLUMNS.users.split(" "),
      ...OMITTED_COLUMNS.users.split(" ").filter((column) => !["steam_name", "steam_profile_url", "avatar_url"].includes(column)),
    ];

    expect(exportQuery("users")).not.toContain("steam_name");
    expect(exportQuery("users")).not.toContain("steam_profile_url");
    expect(exportQuery("users")).not.toContain("avatar_url");

    const expected = readExpectedMigrations();
    const cleanupIndex = expected.findIndex(({ tag }) => tag === PREVIEW_STEAM_SHADOW_CLEANUP_MIGRATION);
    expect(cleanupIndex).toBeGreaterThan(0);

    const preCleanupExpected = expected.slice(0, cleanupIndex);
    const preCleanupPolicy = previewPolicyFor(
      preCleanupExpected.map(({ hash, when }) => ({ hash, when })),
      expected,
    );
    expect(() => assertReviewedColumns("users", [
      ...physicalUsersAfterCleanup,
      "steam_name",
      "steam_profile_url",
      "avatar_url",
    ], preCleanupPolicy)).not.toThrow();
    expect(() => assertReviewedColumns("users", physicalUsersAfterCleanup, preCleanupPolicy)).not.toThrow();

    const cleanupPolicy = previewPolicyFor(
      expected.map(({ hash, when }) => ({ hash, when })),
      expected,
    );
    expect(cleanupPolicy.tables.users.removedColumns).toEqual(["steam_name", "steam_profile_url", "avatar_url"]);
    expect(() => assertReviewedColumns("users", physicalUsersAfterCleanup, cleanupPolicy)).not.toThrow();
    expect(() => assertReviewedColumns("users", physicalUsersAfterCleanup)).not.toThrow();
    expect(() => assertReviewedColumns("users", [...physicalUsersAfterCleanup, "steam_name"], cleanupPolicy)).toThrow(/removed mirror column/);
    expect(() => assertReviewedColumns("users", [...physicalUsersAfterCleanup, "steam_name"])).toThrow(/removed mirror column/);
  });
});
