import { describe, expect, it } from "vitest";
import {
  auditTargetKey,
  groupAuditTargets,
  resolveAuditTargets,
  type AuditDatabaseExecutor,
} from "@/lib/audit/targets";
import {
  competitivePlatforms,
  competitivePlatformSeasons,
  competitionEntries,
  educationVerifications,
  institutions,
  majorFinalResults,
  majorTournamentEntrants,
  matches,
  postEventAdjudications,
  seasons,
  teams,
  tournamentHonors,
  users,
} from "@/db/schema";

function fakeExecutor(responses: Map<unknown, unknown[]>) {
  const selectedTables: unknown[] = [];
  const executor = {
    select: () => {
      let table: unknown;
      const builder = {
        from(nextTable: unknown) {
          table = nextTable;
          selectedTables.push(nextTable);
          return builder;
        },
        where() {
          return builder;
        },
        then(resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) {
          return Promise.resolve(responses.get(table) ?? []).then(resolve, reject);
        },
      };
      return builder;
    },
  } as unknown as AuditDatabaseExecutor;
  return { executor, selectedTables };
}

describe("audit target resolver", () => {
  it("resolves legacy and current targets through canonical owners", async () => {
    const userId = "user-1";
    const seasonId = "season-1";
    const teamId = "team-1";
    const entryId = "entry-1";
    const opponentEntryId = "entry-2";
    const matchId = "match-1";
    const educationId = "education-1";
    const entrantId = "entrant-1";
    const finalResultId = "final-result-1";
    const adjudicationId = "adjudication-1";
    const honorId = "honor-1";
    const platformKey = "perfect-world";
    const platformSeasonId = "platform-season-1";
    const { executor } = fakeExecutor(new Map<unknown, unknown[]>([
      [users, [{ id: userId, email: "player@example.test", displayName: "玩家甲", perfectName: null, steamName: null }]],
      [seasons, [{ id: seasonId, name: "Major 2027" }]],
      [teams, [{ id: teamId, name: "Alpha" }]],
      [competitionEntries, [
        { id: entryId, name: "Alpha Entry" },
        { id: opponentEntryId, name: "Beta Entry" },
      ]],
      [educationVerifications, [{ id: educationId, userId, institutionId: "institution-1" }]],
      [institutions, [{ id: "institution-1", name: "南京大学" }]],
      [competitivePlatforms, [{ key: platformKey, displayName: "完美世界竞技平台" }]],
      [competitivePlatformSeasons, [{ id: platformSeasonId, platform: platformKey, label: "2026 S2" }]],
      [majorTournamentEntrants, [{ id: entrantId, competitionEntryId: entryId }]],
      [matches, [{ id: matchId, entryAId: entryId, entryBId: opponentEntryId }]],
      [majorFinalResults, [{ id: finalResultId, seasonId, championEntryId: entryId }]],
      [postEventAdjudications, [{ id: adjudicationId, seasonId, kind: "placement_statement" }]],
      [tournamentHonors, [{ id: honorId, seasonId, label: "最佳选手", entryId, userId: null }]],
    ]));

    const result = await resolveAuditTargets([
      { targetType: "user", targetId: userId },
      { targetType: "season", targetId: seasonId },
      { targetType: "team", targetId: teamId },
      { targetType: "competition_entry", targetId: entryId },
      { targetType: "education_verification", targetId: educationId },
      { targetType: "competitive_platform", targetId: platformKey },
      { targetType: "competitive_platform_season", targetId: platformSeasonId },
      { targetType: "major_tournament_entrant", targetId: entrantId },
      { targetType: "match", targetId: matchId },
      { targetType: "major_final_result", targetId: finalResultId },
      { targetType: "post_event_adjudication", targetId: adjudicationId },
      { targetType: "tournament_honor", targetId: honorId },
    ], executor);

    expect(result[auditTargetKey("user", userId)]).toMatchObject({ label: "玩家甲", found: true });
    expect(result[auditTargetKey("season", seasonId)]).toMatchObject({ label: "Major 2027", found: true });
    expect(result[auditTargetKey("team", teamId)]).toMatchObject({ label: "Alpha", found: true });
    expect(result[auditTargetKey("competition_entry", entryId)]).toMatchObject({ label: "Alpha Entry", found: true });
    expect(result[auditTargetKey("education_verification", educationId)]).toMatchObject({ label: "认证 · 玩家甲 · 南京大学", found: true });
    expect(result[auditTargetKey("competitive_platform", platformKey)]).toMatchObject({ label: "完美世界竞技平台", found: true });
    expect(result[auditTargetKey("competitive_platform_season", platformSeasonId)]).toMatchObject({ label: "完美世界竞技平台 · 2026 S2", found: true });
    expect(result[auditTargetKey("major_tournament_entrant", entrantId)]).toMatchObject({ label: "Major 参赛队 · Alpha Entry", found: true });
    expect(result[auditTargetKey("match", matchId)]).toMatchObject({ label: "Alpha Entry vs Beta Entry", found: true });
    expect(result[auditTargetKey("major_final_result", finalResultId)]).toMatchObject({ label: "Major 最终赛果 · Major 2027 · 冠军 Alpha Entry", found: true });
    expect(result[auditTargetKey("post_event_adjudication", adjudicationId)]).toMatchObject({ label: "赛后裁定 · Major 2027 · 赛事名次", found: true });
    expect(result[auditTargetKey("tournament_honor", honorId)]).toMatchObject({ label: "赛事荣誉 · 最佳选手 · Alpha Entry · Major 2027", found: true });
  });

  it("deduplicates IDs and performs one query per target type, not per row", async () => {
    const ids = Array.from({ length: 20 }, (_, index) => `user-${index}`);
    const { executor, selectedTables } = fakeExecutor(new Map<unknown, unknown[]>([
      [users, ids.map((id) => ({ id, email: `${id}@example.test`, displayName: id, perfectName: null, steamName: null }))],
    ]));
    const refs = [...ids.flatMap((targetId) => [
      { targetType: "user", targetId },
      { targetType: "user", targetId },
    ]), { targetType: "user", targetId: ids[0] }];

    expect(groupAuditTargets(refs)).toEqual(new Map([["user", ids]]));
    await resolveAuditTargets(refs, executor);
    expect(selectedTables.filter((table) => table === users)).toHaveLength(1);
  });

  it("keeps deleted targets human-readable with a weak short-ID fallback", async () => {
    const { executor } = fakeExecutor(new Map());
    const result = await resolveAuditTargets([{ targetType: "education_verification", targetId: "deleted-123456" }], executor);
    const target = result[auditTargetKey("education_verification", "deleted-123456")];

    expect(target).toMatchObject({ typeLabel: "教育认证", found: false });
    expect(target.label).toContain("记录未找到");
    expect(target.label).not.toContain("education_verification:");
  });
});
