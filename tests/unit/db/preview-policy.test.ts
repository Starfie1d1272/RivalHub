import { describe, expect, it } from "vitest";
import { readExpectedMigrations } from "../../../scripts/db/production-preflight";
import { assertReviewedColumns, exportQuery, OMITTED_COLUMNS, PREVIEW_COLUMNS, previewPolicyFor } from "../../../scripts/db/preview/policy";

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
    const beforeSteamProfile = expected.slice(0, -1).map(({ hash, when }) => ({ hash, when }));
    const beforeStatsExpansion = expected.slice(0, -2).map(({ hash, when }) => ({ hash, when }));

    const lagging = previewPolicyFor(beforeSteamProfile);
    const older = previewPolicyFor(beforeStatsExpansion);

    expect(lagging.tables).not.toHaveProperty("steam_profiles");
    expect(lagging.futureTables).toContain("steam_profiles");
    expect(() => assertReviewedColumns("steam_profiles", ["id"], lagging)).toThrow(/outside the active source policy/);
    expect(older.futureColumns.match_player_stats).toEqual(expect.arrayContaining(["first_deaths", "trade_kills", "kast_rounds", "dak_import_id"]));
    expect(older.tables.match_player_stats.exportedColumns).not.toContain("first_deaths");
  });

  it("reviews retained Steam rollback shadows while allowing their later contract cleanup drop", () => {
    const physicalUsersAfterCleanup = [
      ...PREVIEW_COLUMNS.users.split(" "),
      ...OMITTED_COLUMNS.users.split(" ").filter((column) => !["steam_name", "steam_profile_url", "avatar_url"].includes(column)),
    ];

    expect(() => assertReviewedColumns("users", [
      ...physicalUsersAfterCleanup,
      "steam_name",
      "steam_profile_url",
      "avatar_url",
    ])).not.toThrow();
    expect(() => assertReviewedColumns("users", physicalUsersAfterCleanup)).not.toThrow();
    expect(exportQuery("users")).not.toContain("steam_name");
    expect(exportQuery("users")).not.toContain("steam_profile_url");
    expect(exportQuery("users")).not.toContain("avatar_url");
  });
});
