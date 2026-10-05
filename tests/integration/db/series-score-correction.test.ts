import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "../../../src/db/client";
import * as schema from "../../../src/db/schema";
import { seedFixture } from "./harness/mizar";
import { planSeriesAfterMapScoreChangeInTx, correctSeriesAfterMapScoreChangeInTx, type SeriesCorrectionRequest } from "../../../src/lib/matches/series-score-correction";
import { correctMapScoreInTx } from "../../../src/lib/matches/map-score-correction";
import { loadOperatorContext } from "../../../src/lib/admin/matches/operator-context";
import { loadEffectiveMatchRoster } from "../../../src/lib/match-rosters/effective";
import { readRivalHubEvents } from "../../../src/lib/demo-integration/read";
import { buildEvidenceRevisionForTarget } from "../../../src/lib/demo-integration/revision";
import { getCurrentStatsSelectionInTx } from "../../../src/lib/stats/tournament-query";
import { CURRENT_DAK_SEMANTIC_PROFILE } from "../../../src/lib/demo-integration/semantic-profile";
import { createStageBracket, saveStageBracketState, advanceStageBracket, ensureResolvedBracketMatch, loadStageBracketNodeViews } from "../../../src/lib/bracket";
import normalEvidence from "../../fixtures/demo-evidence/normal-map-v1.json";
import { parseRivalHubDemoEvidenceV1 } from "../../../src/lib/demo-evidence/contract";
import { adaptStatsEvidence } from "../../../src/lib/stats/evidence-adapter";
import { collectTournamentPerformanceMapProjection } from "@cs2dak/tournament";
import { STATISTICS_PROJECTION_VERSION } from "../../../src/lib/stats/projection-version";
const end = new Date("2026-10-01T12:30:00Z");
async function fixture(aWins = true) {
  const f = await seedFixture({ unboundSource: true }); const mapThreeId = randomUUID();
  await db.update(schema.matchMaps).set({ scoreA: aWins ? 13 : 9, scoreB: aWins ? 9 : 13, completedAt: new Date(end.getTime() - 3600000) }).where(eq(schema.matchMaps.id, f.mapOneId));
  await db.update(schema.matchMaps).set({ scoreA: aWins ? 9 : 13, scoreB: aWins ? 13 : 9, completedAt: end }).where(eq(schema.matchMaps.id, f.mapTwoId));
  await db.insert(schema.matchMaps).values({ id: mapThreeId, matchId: f.matchId, mapOrder: 3, mapName: "de_nuke" });
  const request: SeriesCorrectionRequest = { matchId: f.matchId, mapId: f.mapTwoId, scoreA: aWins ? 13 : 9, scoreB: aWins ? 9 : 13, expectedScoreA: aWins ? 9 : 13, expectedScoreB: aWins ? 13 : 9 };
  return { ...f, mapThreeId, request };
}
async function confirmation(request: SeriesCorrectionRequest) {
  const preview = await db.transaction(tx => planSeriesAfterMapScoreChangeInTx(tx, request));
  return { ...request, previewRevision: preview!.revision, reason: "核对 Perfect 最终比分", confirmed: true as const, laterMapsNotStarted: true as const };
}
const apply = (input: Awaited<ReturnType<typeof confirmation>>) => db.transaction(tx => correctSeriesAfterMapScoreChangeInTx(tx, input, "integration-admin"));
describe("reviewed early series completion PostgreSQL", () => {
  it.each([true, false])("finishes BO3 symmetrically, preserving only actual-map tasks (%s)", async aWins => {
    const f = await fixture(aWins); const input = await confirmation(f.request); await apply(input);
    const match = (await db.query.matches.findFirst({ where: eq(schema.matches.id, f.matchId) }))!;
    expect(match).toMatchObject({ status: "finished", scoreA: aWins ? 2 : 0, scoreB: aWins ? 0 : 2, completedAt: end });
    expect(match.scoreA! > match.scoreB! ? match.entryAId : match.entryBId).toBe(aWins ? f.entryAId : f.entryBId);
    const maps = await db.query.matchMaps.findMany({ where: eq(schema.matchMaps.matchId, f.matchId) });
    expect(maps.find(row => row.id === f.mapThreeId)).toMatchObject({ scoreA: null, scoreB: null, completedAt: null });
    const context = await loadOperatorContext({ match, maps, imports: [], roster: await loadEffectiveMatchRoster(db, [match.id]), seasonName: "Fixture", stageName: null, isSwiss: false, teamAName: "A", teamBName: "B", vetoComplete: true });
    expect(context.workflow.roomMapId).toBeNull(); expect(context.workflow.completedMaps.map(row => row.order)).toEqual([1, 2]); expect(context.workflow.isPostMatch).toBe(true);
    const events = await readRivalHubEvents({ seasonIds: [f.seasonId] }); expect(events.events[0]!.series.find(row => row.id === match.id)!.maps.map(row => row.order)).toEqual([1, 2]);
    const audit = await db.query.auditLogs.findMany({ where: and(eq(schema.auditLogs.targetId, match.id), eq(schema.auditLogs.action, "match.series.corrected")) }); expect(audit).toHaveLength(1);
  });
  it("serializes duplicate confirmations without replaying completion or audit", async () => {
    const f = await fixture(); const input = await confirmation(f.request);
    const results = await Promise.all([apply(input), apply(input)]); expect(results.map(row => row.alreadyApplied).sort()).toEqual([false, true]);
    const before = await db.query.matches.findFirst({ where: eq(schema.matches.id, f.matchId) }); expect((await apply(input)).alreadyApplied).toBe(true);
    expect((await db.query.matches.findFirst({ where: eq(schema.matches.id, f.matchId) }))?.completedAt).toEqual(before?.completedAt);
    expect(await db.query.auditLogs.findMany({ where: and(eq(schema.auditLogs.targetId, f.matchId), eq(schema.auditLogs.action, "match.series.corrected")) })).toHaveLength(1);
  });
  it.each(["active", "historical", "result", "ocr"])("blocks Map 3 facts (%s) without deleting them", async kind => {
    const f = await fixture();
    if (kind === "active") await db.update(schema.matchLiveSessions).set({ currentMapId: f.mapThreeId, mapExecutionPhase: "gameplay" }).where(eq(schema.matchLiveSessions.id, f.sessionId));
    if (kind === "historical") await db.insert(schema.auditLogs).values({ seasonId: f.seasonId, targetId: f.matchId, action: "mizar.reliable.accept", targetType: "match", meta: { kind: "map_started", receivedMapId: f.mapThreeId, receivedMapName: "de_nuke", outcome: "armed" } });
    if (kind === "result") await db.update(schema.matchMaps).set({ scoreA: 9, scoreB: 13, completedAt: end }).where(eq(schema.matchMaps.id, f.mapThreeId));
    if (kind === "ocr") await db.insert(schema.matchPlayerStats).values({ matchId: f.matchId, mapId: f.mapThreeId, perfectName: "真实数据", kills: 1 });
    const preview = await db.transaction(tx => planSeriesAfterMapScoreChangeInTx(tx, f.request)); expect(preview!.blockers.join(" ")).toMatch(/Map 3/);
    await expect(apply(await confirmation(f.request))).rejects.toThrow(/Map 3/);
    expect((await db.query.matches.findFirst({ where: eq(schema.matches.id, f.matchId) }))?.status).toBe("in_progress");
    expect(await db.query.matchMaps.findFirst({ where: eq(schema.matchMaps.id, f.mapThreeId) })).toBeDefined();
  });
  it.each(["score", "source", "later-map", "same-round"])("refuses stale preview (%s)", async kind => {
    const f = await fixture(); const input = await confirmation(f.request);
    if (kind === "same-round") await db.insert(schema.matches).values({ seasonId: f.seasonId, stage: "fixture-stage", entryAId: f.entryAId, entryBId: f.entryBId, format: "bo3", status: "scheduled" });
    if (kind === "score") await db.update(schema.matchMaps).set({ scoreA: 10 }).where(eq(schema.matchMaps.id, f.mapTwoId));
    if (kind === "source") await db.update(schema.matchLiveSessions).set({ lastReliableSeq: 20 }).where(eq(schema.matchLiveSessions.id, f.sessionId));
    if (kind === "later-map") await db.update(schema.matchLiveSessions).set({ currentMapId: f.mapThreeId, mapExecutionPhase: "gameplay" }).where(eq(schema.matchLiveSessions.id, f.sessionId));
    await expect(apply(input)).rejects.toThrow(/已更新|已变化/);
    expect((await db.query.matches.findFirst({ where: eq(schema.matches.id, f.matchId) }))?.status).toBe("in_progress");
  });
  it("requires reason and explicit acknowledgement; ordinary correction still fails closed", async () => {
    const f = await fixture(); const input = await confirmation(f.request);
    await expect(apply({ ...input, reason: "" })).rejects.toThrow();
    await expect(apply({ ...input, confirmed: false } as never)).rejects.toThrow();
    await expect(db.transaction(tx => correctMapScoreInTx(tx, { matchId: f.matchId, mapId: f.mapTwoId, scoreA: 13, scoreB: 9, actorId: "admin", review: { expectedScoreA: 9, expectedScoreB: 13, reason: "复核" } }))).rejects.toThrow("提前结束");
    await db.transaction(tx => correctMapScoreInTx(tx, { matchId: f.matchId, mapId: f.mapTwoId, scoreA: 10, scoreB: 13, actorId: "admin", review: { expectedScoreA: 9, expectedScoreB: 13, reason: "复核" } }));
    expect((await db.query.matches.findFirst({ where: eq(schema.matches.id, f.matchId) }))?.status).toBe("in_progress");
  });
  it("keeps OCR/raw Evidence, marks stale Demo in canonical reads and excludes its statistics", async () => {
    const f = await fixture();
    const match = (await db.query.matches.findFirst({ where: eq(schema.matches.id, f.matchId) }))!;
    const maps = await db.query.matchMaps.findMany({ where: eq(schema.matchMaps.matchId, f.matchId) });
    const roster = await loadEffectiveMatchRoster(db, [match.id]);
    const pairingIntentId = randomUUID(), pairingId = randomUUID(), importId = randomUUID();
    const revision = buildEvidenceRevisionForTarget({ match, map: maps.find(row => row.id === f.mapTwoId)!, roster });
    const owner = (await db.query.competitionEntries.findFirst({ where: eq(schema.competitionEntries.id, f.entryAId) }))!.representativeUserId!;
    await db.insert(schema.dakPairingIntents).values({ id: pairingIntentId, pollTokenHash: randomUUID(), expiresAt: new Date(Date.now() + 600000) });
    await db.insert(schema.dakPairings).values({ id: pairingId, pairingIntentId, userId: owner, tokenHash: randomUUID(), scopes: ["events:read", "evidence:write"], seasonIds: [f.seasonId] });
    const payload = { preserved: "immutable gameplay evidence" };
    await db.insert(schema.matchDemoImports).values({ id: importId, seasonId: f.seasonId, matchId: f.matchId, matchMapId: f.mapTwoId, stageKey: match.stage, demoSha256: "a".repeat(64), payloadSha256: "b".repeat(64), contractVersion: "rivalhub-demo-evidence/1", semanticProfile: CURRENT_DAK_SEMANTIC_PROFILE, analysisVersion: "fixture", evidenceRevision: revision, status: "confirmed", payload, submittedByPairingId: pairingId, confirmedAt: end });
    const evidence = parseRivalHubDemoEvidenceV1(normalEvidence);
    const bindings = roster.map(member => ({ steam64: member.steam64!, userId: member.userId, entryId: member.entryId }));
    evidence.participants.forEach((participant, index) => { participant.steamId64 = bindings[index]!.steam64; });
    const adapted = adaptStatsEvidence(evidence, new Map(bindings.map(binding => [binding.steam64, binding])));
    await db.insert(schema.matchDemoStatProjections).values({ importId, projectionVersion: STATISTICS_PROJECTION_VERSION, payloadSha256: "b".repeat(64), demoSha256: "a".repeat(64), semanticProfile: CURRENT_DAK_SEMANTIC_PROFILE, analysisVersion: "fixture", evidenceRevision: revision, identityBindings: bindings, facts: { tournament: adapted.tournament, performance: collectTournamentPerformanceMapProjection(adapted.performance) } });
    expect((await db.transaction(tx => getCurrentStatsSelectionInTx(tx, { seasonId: f.seasonId }))).currentImportIds).toContain(importId);
    await db.insert(schema.matchPlayerStats).values({ matchId: f.matchId, mapId: f.mapTwoId, perfectName: "原始 OCR", kills: 17, deaths: 9, assists: 3, userId: owner, dakImportId: importId });
    const before = (await readRivalHubEvents({ seasonIds: [f.seasonId] })).events[0]!.series.find(row => row.id === match.id)!;
    expect(before.maps.find(row => row.id === f.mapTwoId)?.demoStatus).toBe("synced");
    await apply(await confirmation(f.request));
    const after = (await readRivalHubEvents({ seasonIds: [f.seasonId] })).events[0]!.series.find(row => row.id === match.id)!;
    expect(after.maps.find(row => row.id === f.mapTwoId)).toMatchObject({ demoStatus: "needs_attention" });
    expect(after.maps.find(row => row.id === f.mapTwoId)?.demoIssues).toContainEqual(expect.objectContaining({ code: "STALE_EVIDENCE" }));
    expect(after.maps.find(row => row.id === f.mapOneId)?.evidenceRevision).toBe(before.maps.find(row => row.id === f.mapOneId)?.evidenceRevision);
    expect((await db.query.matchDemoImports.findFirst({ where: eq(schema.matchDemoImports.id, importId) }))?.payload).toEqual(payload);
    expect(await db.query.matchPlayerStats.findFirst({ where: eq(schema.matchPlayerStats.mapId, f.mapTwoId) })).toMatchObject({ kills: 17, deaths: 9, assists: 3, dakImportId: importId });
    expect((await db.transaction(tx => getCurrentStatsSelectionInTx(tx, { seasonId: f.seasonId }))).currentImportIds).not.toContain(importId);
    expect(await db.query.matchDemoStatProjections.findFirst({ where: eq(schema.matchDemoStatProjections.importId, importId) })).toMatchObject({ evidenceRevision: revision, identityBindings: bindings });
  });

  async function bracketFixture() {
    const f = await fixture();
    const extra = [randomUUID(), randomUUID()];
    const owner = (await db.query.competitionEntries.findFirst({ where: eq(schema.competitionEntries.id, f.entryAId) }))!.representativeUserId!;
    const revisions = extra.map(() => randomUUID());
    await db.transaction(async tx => {
      await tx.insert(schema.competitionEntries).values(extra.map((id, index) => ({ id, competitionId: f.seasonId, source: "event_native" as const, name: `Other ${index}`, representativeUserId: owner, currentRosterRevisionId: revisions[index]! })));
      await tx.insert(schema.competitionEntryRepresentativeChanges).values(extra.map(id => ({ entryId: id, toUserId: owner, changedByActorId: owner })));
      await tx.insert(schema.competitionEntryRosterRevisions).values(extra.map((id, index) => ({ id: revisions[index]!, entryId: id, revisionNumber: 1, createdBy: owner })));
    });
    const entries = (await db.query.competitionEntries.findMany({ where: eq(schema.competitionEntries.competitionId, f.seasonId) }));
    // Seed A/B opposite the other completed semifinal, independently of query order.
    const ordered = [entries.find(row => row.id === f.entryAId)!, entries.find(row => row.id === extra[0])!, entries.find(row => row.id === extra[1])!, entries.find(row => row.id === f.entryBId)!];
    const bracket = await createStageBracket({ key: "fixture-stage", name: "淘汰赛", type: "single_elim" }, ordered);
    const node = bracket.resolvedMatches.find(row => row.entryAId === f.entryAId && row.entryBId === f.entryBId)!;
    const other = bracket.resolvedMatches.find(row => row.bracketMatchId !== node.bracketMatchId)!;
    await db.update(schema.matches).set({ bracketNodeId: String(node.bracketMatchId) }).where(eq(schema.matches.id, f.matchId));
    await db.update(schema.seasons).set({ stagePlan: [{ key: "fixture-stage", name: "淘汰赛", type: "single_elim", teamCount: 4, matchFormat: "bo3", finalFormat: "bo3", advanceTiers: [] }] }).where(eq(schema.seasons.id, f.seasonId));
    const advanced = await advanceStageBracket("fixture-stage", String(other.bracketMatchId), { scoreA: 2, scoreB: 0 }, bracket.data);
    await db.transaction(async tx => {
      await saveStageBracketState(tx, f.seasonId, "fixture-stage", advanced.updatedData);
      await ensureResolvedBracketMatch(tx, { seasonId: f.seasonId, stageKey: "fixture-stage", resolved: other, format: "bo3" });
      await tx.update(schema.matches).set({ status: "finished", scoreA: 2, scoreB: 0, completedAt: end }).where(and(eq(schema.matches.seasonId, f.seasonId), eq(schema.matches.bracketNodeId, String(other.bracketMatchId))));
    });
    return f;
  }
  it("advances the canonical bracket once and materializes the winner-dependent final", async () => {
    const f = await bracketFixture(); const input = await confirmation(f.request); await apply(input); await apply(input);
    const rows = await db.query.matches.findMany({ where: eq(schema.matches.seasonId, f.seasonId) });
    const final = rows.filter(row => row.status === "scheduled"); expect(final).toHaveLength(1);
    expect([final[0]!.entryAId, final[0]!.entryBId]).toContain(f.entryAId); expect([final[0]!.entryAId, final[0]!.entryBId]).not.toContain(f.entryBId);
  });
  it("shows and blocks an already-started downstream final, preserving its facts", async () => {
    const f = await bracketFixture();
    const nodes = (await loadStageBracketNodeViews(db, f.seasonId)).get("fixture-stage")!;
    const finalId = nodes.find(row => !row.nextWinNodeId && !row.nextLossNodeId)!.id;
    const downstreamId = randomUUID(); await db.insert(schema.matches).values({ id: downstreamId, seasonId: f.seasonId, stage: "fixture-stage", entryAId: f.entryAId, entryBId: f.entryBId, format: "bo3", status: "in_progress", startedAt: end, bracketNodeId: finalId });
    const preview = await db.transaction(tx => planSeriesAfterMapScoreChangeInTx(tx, f.request)); expect(preview).toMatchObject({ downstreamCount: 1 }); expect(preview?.blockers.join(" ")).toContain("下游比赛已开始");
    await expect(apply(await confirmation(f.request))).rejects.toThrow("下游比赛已开始");
    expect((await db.query.matches.findFirst({ where: eq(schema.matches.id, downstreamId) }))?.startedAt).toEqual(end);
  });
  it.each(["swiss", "single_elim"] as const)("keeps %s stage advancement on its canonical round owner", async stageType => {
    const f = await fixture(); const runId = randomUUID();
    const stage = { key: "fixture-stage", name: "阶段", type: stageType, teamCount: stageType === "swiss" ? 16 : 8, matchFormat: "bo3" as const, finalFormat: stageType === "swiss" ? null : "bo5" as const, advanceTiers: [] };
    await db.update(schema.seasons).set({ stagePlan: [{ ...stage, finalFormat: stage.finalFormat ?? undefined }] }).where(eq(schema.seasons.id, f.seasonId));
    await db.insert(schema.majorStageRuns).values({ id: runId, seasonId: f.seasonId, stageKey: stage.key, startedBy: "admin", finalizedRound: 0, ruleSnapshot: { version: 4, stagePlan: [stage], rosterRules: { minTeamSize: 5, maxTeamSize: 7, starterCount: 5 }, affiliationRules: [], competitiveProfile: null, frozenCompetitiveFacts: [], runOptions: { hasThirdPlaceMatch: false } } });
    await db.update(schema.matches).set({ ownership: "major_stage", majorStageRunId: runId, managedKey: stageType === "swiss" ? "swiss-1-1" : "qf-1", round: 1, entryRound: stageType === "swiss" ? null : "quarterfinal" }).where(eq(schema.matches.id, f.matchId));
    const input = await confirmation(f.request); await apply(input);
    expect((await db.query.majorStageRuns.findFirst({ where: eq(schema.majorStageRuns.id, runId) }))?.finalizedRound).toBe(0);
    expect((await db.query.matches.findFirst({ where: eq(schema.matches.id, f.matchId) }))?.scoreA).toBe(2);
    expect(await db.query.matches.findMany({ where: eq(schema.matches.majorStageRunId, runId) })).toHaveLength(1);
  });

});
