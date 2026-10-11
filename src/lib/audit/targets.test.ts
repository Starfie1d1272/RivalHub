import { describe, expect, it } from "vitest";
import {
  auditTargetKey,
  groupAuditTargets,
  normalizeAuditTarget,
  resolveAuditTargets,
  type AuditDatabaseExecutor,
} from "@/lib/audit/targets";
import {
  mizarInstallations,
  dakPairings,
  competitivePlatforms,
  competitivePlatformSeasons,
  competitionEntries,
  educationVerifications,
  institutions,
  majorFinalResults,
  majorTournamentEntrants,
  matchDemoImports,
  matchMaps,
  matches,
  postEventAdjudications,
  seasons,
  teams,
  tournamentHonors,
  userGameplaySteamIds,
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
        leftJoin() {
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
  it("batches machine targets, separates authorization context and omits credential data", async () => {
    const { executor, selectedTables } = fakeExecutor(new Map<unknown, unknown[]>([
      [mizarInstallations, [{ id: "installation", competitionId: "season", authorizedByUserId: "authorizer", revokedAt: new Date(), credentialHash: "secret-hash" }]],
      [dakPairings, [{ id: "pairing", userId: "authorizer", status: "active", tokenHash: "secret-token" }]],
      [users, [{ id: "authorizer", email: "private@example.test", displayName: null, personaName: null, perfectName: null }]],
      [seasons, [{ id: "season", name: "春季赛" }]],
    ]));
    const targets = await resolveAuditTargets(Array.from({ length: 20 }, () => [
      { targetType: "mizar_installation", targetId: "installation" },
      { targetType: "dak_pairing", targetId: "pairing" },
    ]).flat(), executor);
    expect(targets["mizar_installation:installation"]).toMatchObject({ label: "Mizar · 春季赛 · 已撤销", context: "设备授权者：未知用户", status: "resolved" });
    expect(targets["dak_pairing:pairing"]).toMatchObject({ label: "DAK Studio · 使用中", context: "设备授权者：未知用户", status: "resolved" });
    expect(selectedTables.filter(table => table === mizarInstallations)).toHaveLength(1);
    expect(selectedTables.filter(table => table === dakPairings)).toHaveLength(1);
    expect(JSON.stringify(Object.values(targets))).not.toMatch(/secret|private|authorizer|credentialHash|tokenHash/);
  });

  it("distinguishes unsupported, missing and historical targets", async () => {
    const { executor } = fakeExecutor(new Map());
    const result = await resolveAuditTargets([
      { targetType: "future_secret", targetId: "private-id" },
      { targetType: "mizar_installation", targetId: "missing" },
      { action: "season_public_info.group.delete", targetType: "community_group", targetId: "deleted" },
    ], executor);
    expect(result["future_secret:private-id"]).toMatchObject({ status: "unsupported", found: false });
    expect(result["mizar_installation:missing"]).toMatchObject({ status: "missing", found: false });
    expect(result["community_group:deleted"]).toMatchObject({ status: "tombstone", found: false });
  });

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
      [users, [{ id: userId, email: "player@example.test", displayName: "玩家甲", perfectName: null, personaName: null }]],
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
      [users, ids.map((id) => ({ id, email: `${id}@example.test`, displayName: id, perfectName: null, personaName: null }))],
    ]));
    const refs = [...ids.flatMap((targetId) => [
      { targetType: "user", targetId },
      { targetType: "user", targetId },
    ]), { targetType: "user", targetId: ids[0] }];

    expect(groupAuditTargets(refs)).toEqual(new Map([["user", ids]]));
    await resolveAuditTargets(refs, executor);
    expect(selectedTables.filter((table) => table === users)).toHaveLength(1);
  });

  it("keeps deleted targets human-readable without a raw identifier", async () => {
    const { executor } = fakeExecutor(new Map());
    const result = await resolveAuditTargets([{ targetType: "education_verification", targetId: "deleted-123456" }], executor);
    const target = result[auditTargetKey("education_verification", "deleted-123456")];

    expect(target).toMatchObject({ typeLabel: "教育认证", found: false });
    expect(target.label).toContain("记录未找到");
    expect(target.label).not.toContain("education_verification:");
    expect(target.label).not.toContain("deleted-");
  });

  it("preserves stored legacy target types and safely handles missing Demo imports", async () => {
    expect(normalizeAuditTarget({ action: "match.import_demo", targetType: "match_map", targetId: "map-1" }))
      .toEqual({ targetType: "match_map", targetId: "map-1", lifecycle: "stable" });
    const { executor } = fakeExecutor(new Map());
    const targets = await resolveAuditTargets([{ action: "match.demo.needs_attention", targetType: "match_demo_import", targetId: "private-import-id" }], executor);
    expect(targets[auditTargetKey("match_demo_import", "private-import-id")]).toEqual({ typeLabel: "Demo 数据", label: "记录未找到", found: false, status: "missing" });
  });

  it("projects legacy recruitment interest removals onto their stable intent", async () => {
    const legacyRef = {
      action: "recruitment.interest.withdraw",
      targetType: "recruitment_interest",
      targetId: "deleted-interest",
      meta: { recruitmentIntentId: "intent-1" },
    };
    expect(normalizeAuditTarget(legacyRef)).toEqual({ targetType: "recruitment_intent", targetId: "intent-1", lifecycle: "stable" });

    const { executor } = fakeExecutor(new Map());
    const targets = await resolveAuditTargets([legacyRef], executor);
    expect(targets[auditTargetKey("recruitment_intent", "intent-1")]).toMatchObject({
      typeLabel: "招募意向",
      found: false,
    });
  });

  it("projects legacy public-info child rows from their action contract", () => {
    expect(normalizeAuditTarget({
      action: "season_public_info.group.delete",
      targetType: "season_public_info",
      targetId: "group-1",
    })).toEqual({ targetType: "community_group", targetId: "group-1", lifecycle: "tombstone" });
    expect(normalizeAuditTarget({
      action: "season_public_info.contact.update",
      targetType: "season_public_info",
      targetId: "contact-1",
    })).toEqual({ targetType: "season_contact", targetId: "contact-1", lifecycle: "stable" });
  });

  it("uses an explicit historical fallback for intentional tombstones", async () => {
    const { executor } = fakeExecutor(new Map());
    const result = await resolveAuditTargets([{
      action: "season_public_info.group.delete",
      targetType: "season_public_info",
      targetId: "deleted-group",
    }], executor);
    const target = result[auditTargetKey("community_group", "deleted-group")];

    expect(target).toMatchObject({ typeLabel: "社区群组", found: false });
    expect(target.label).toContain("已删除 / 历史目标");
  });

  it("resolves Demo imports and gameplay identities without exposing internal ids", async () => {
    const demoId = "demo-1";
    const mapId = "map-1";
    const matchId = "match-demo-1";
    const identityId = "identity-1";
    const userId = "user-demo-1";
    const { executor } = fakeExecutor(new Map<unknown, unknown[]>([
      [matchDemoImports, [{ id: demoId, matchMapId: mapId }]],
      [matchMaps, [{ id: mapId, matchId, mapName: "de_ancient", mapOrder: 2 }]],
      [matches, [{ id: matchId, entryAId: "entry-1", entryBId: "entry-2" }]],
      [competitionEntries, [{ id: "entry-1", name: "Alpha" }, { id: "entry-2", name: "Beta" }]],
      [userGameplaySteamIds, [{ id: identityId, userId, steam64: "76561198000000001", status: "active" }]],
      [users, [{ id: userId, email: "player@example.test", displayName: "玩家甲", perfectName: null, personaName: null }]],
    ]));

    const result = await resolveAuditTargets([
      { action: "match.demo.identity_confirm", targetType: "match_demo_import", targetId: demoId },
      { action: "match.demo.identity_retire", targetType: "user_gameplay_steam_id", targetId: identityId },
    ], executor);

    expect(result[auditTargetKey("match_demo_import", demoId)]).toMatchObject({
      typeLabel: "Demo 数据",
      label: "Alpha vs Beta · 第 2 图 Ancient",
      found: true,
    });
    expect(result[auditTargetKey("user_gameplay_steam_id", identityId)]).toMatchObject({
      typeLabel: "选手 Steam 身份",
      label: "玩家甲 · Steam64 76561198000000001 · 使用中",
      found: true,
    });
    expect(result[auditTargetKey("match_demo_import", demoId)]?.label).not.toContain("demo-1");
  });
});
