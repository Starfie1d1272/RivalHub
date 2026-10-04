import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "../../../src/db/client";
import * as schema from "../../../src/db/schema";
import { AppError, ErrorCode } from "../../../src/lib/errors";
import { loadMizarMatchDocumentInTx } from "../../../src/lib/mizar/context";
import { ingestMizarLive } from "../../../src/lib/mizar/live";
import { ingestMizarReliable } from "../../../src/lib/mizar/reliable";
import { claimMizarSource, releaseMizarSource, takeOverCurrentMap } from "../../../src/lib/mizar/source";
import { loadOperatorEvidence } from "../../../src/lib/admin/matches/operator-evidence";
import { loadOperatorContext } from "../../../src/lib/admin/matches/operator-context";
import { loadEffectiveMatchRoster } from "../../../src/lib/match-rosters/effective";
import { recordManualMapResultInTx } from "../../../src/lib/matches/manual-result";
import { RELIABLE_EVENT_SCHEMA_VERSION } from "../../../src/lib/mizar/protocol";

// The integration runner provisions a disposable database per worker (see
// scripts/db/integration-runner.ts), so committed fixtures need no teardown.
import { seedFixture, NOW, type Fixture } from "./harness/mizar";
import { testSteam64 } from "./harness/database";

function reliableEvent(fixture: Fixture, overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: RELIABLE_EVENT_SCHEMA_VERSION,
    idempotencyKey: `evt-${randomUUID()}`,
    cursor: { producerInstanceId: fixture.producerInstanceId, liveSessionId: fixture.liveSessionId, runtimeSeq: 1, programSourceGeneration: 0, programReceiveSequence: 1, mapEpoch: 1 },
    observedAt: NOW.toISOString(),
    matchId: fixture.matchId,
    competitionId: fixture.seasonId,
    contextRevision: fixture.contextRevision,
    mapId: fixture.mapOneId,
    mapName: "de_ancient",
    entryAId: fixture.entryAId,
    entryBId: fixture.entryBId,
    evidence: { identity: "matched", telemetryFresh: true, contextFresh: true, source: "runtime-transition" },
    kind: "map_started",
    payload: {},
    ...overrides,
  };
}

async function expectCode(work: () => Promise<unknown>, code: ErrorCode) {
  await expect(work()).rejects.toMatchObject({ code });
}

async function loadSource(sessionId: string) {
  const [source] = await db.select().from(schema.matchLiveSessions).where(eq(schema.matchLiveSessions.id, sessionId));
  return source!;
}

async function operatorContext(fixture: Fixture) {
  const [match] = await db.select().from(schema.matches).where(eq(schema.matches.id, fixture.matchId));
  const maps = await db.select().from(schema.matchMaps).where(eq(schema.matchMaps.matchId, fixture.matchId));
  const roster = await loadEffectiveMatchRoster(db, [fixture.matchId]);
  return loadOperatorContext({ match: match!, maps, roster, imports: [], seasonName: "Fixture", stageName: null, isSwiss: false, teamAName: "A", teamBName: "B", vetoComplete: true });
}
function manualCommand(fixture: Fixture, order = 1) {
  return { matchId: fixture.matchId, mapOrder: order, mapName: order === 1 ? "de_ancient" : "de_mirage", scoreA: 13, scoreB: 9, actorId: fixture.entryAId, pickedByEntryId: null, teamAStartSide: null };
}
async function nextEpoch(fixture: Fixture, sequence = 10) {
  const event = reliableEvent(fixture, { kind: "map_epoch_changed", payload: { previousMapEpoch: 1, reason: "next map" } });
  event.cursor.mapEpoch = 2;
  event.cursor.runtimeSeq = sequence;
  await ingestMizarReliable(fixture.installationId, fixture.seasonId, event, fixture.authorityRevision);
  const start = reliableEvent(fixture, { mapId: fixture.mapTwoId, mapName: "de_mirage" });
  start.cursor.mapEpoch = 2;
  start.cursor.runtimeSeq = sequence + 1;
  await ingestMizarReliable(fixture.installationId, fixture.seasonId, start, fixture.authorityRevision, fixture.steam64);
  return start;
}

describe("Mizar reliable event ingest ownership", () => {
  it.each([false, true])("recovers a silent source only through a scoped operator report (unbound=%s)", async unboundSource => {
    const f = await seedFixture({ unboundSource });
    const context = await operatorContext(f);
    expect(context.takeover).toBeNull();
    const recovery = context.problemRecovery!;
    const scope = { sessionId: recovery.sessionId, mapEpoch: recovery.mapEpoch, mapId: recovery.mapId, recoverMapBinding: recovery.recoverMapBinding };
    const reported = { ...scope, operatorReport: { ...recovery.reportContext, reason: "采集电脑断网，已核对正式地图" } };
    await expect(takeOverCurrentMap(f.matchId, f.entryAId, scope)).rejects.toThrow();
    await expect(takeOverCurrentMap(f.matchId, f.entryAId, { ...reported, operatorReport: { ...reported.operatorReport, reason: " " } })).rejects.toThrow();
    await expect(takeOverCurrentMap(f.matchId, f.entryAId, { ...reported, mapId: f.mapTwoId })).rejects.toThrow("重新核对");
    await Promise.all([takeOverCurrentMap(f.matchId, f.entryAId, reported), takeOverCurrentMap(f.matchId, f.entryAId, reported)]);
    expect(await loadSource(f.sessionId)).toMatchObject({ currentMapId: f.mapOneId, manualTakeoverMapEpoch: 1, autoCanonicalizationArmed: false });
    const audits = await db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.targetId, f.matchId), eq(schema.auditLogs.action, "mizar.map.manual_takeover")));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.meta).toMatchObject({ operatorReportedProblem: reported.operatorReport.reason, reviewedReliableSeq: -1, recoveredMapBinding: unboundSource });
    expect((await operatorContext(f)).workflow.manualResultAllowed).toBe(true);
    await db.transaction(tx => recordManualMapResultInTx(tx, manualCommand(f)));
    await expect(takeOverCurrentMap(f.matchId, f.entryAId, reported)).rejects.toThrow("正式赛果");
    await nextEpoch(f);
    expect(await loadSource(f.sessionId)).toMatchObject({ currentMapId: f.mapTwoId, autoCanonicalizationArmed: true });
  });

  it("rejects an operator report after reliable progress or a same-epoch generation change", async () => {
    const f = await seedFixture();
    const recovery = (await operatorContext(f)).problemRecovery!;
    const reported = { sessionId: recovery.sessionId, mapEpoch: recovery.mapEpoch, mapId: recovery.mapId, operatorReport: { ...recovery.reportContext, reason: "已确认断网" } };
    await ingestMizarReliable(f.installationId, f.seasonId, reliableEvent(f), f.authorityRevision, f.steam64);
    await expect(takeOverCurrentMap(f.matchId, f.entryAId, reported)).rejects.toThrow("采集状态已变化");
    const refreshed = (await operatorContext(f)).problemRecovery!;
    const generation = reliableEvent(f, { kind: "source_generation_changed", payload: { previousSourceGeneration: 0 } });
    generation.cursor.runtimeSeq = 2;
    generation.cursor.programSourceGeneration = 1;
    await ingestMizarReliable(f.installationId, f.seasonId, generation, f.authorityRevision);
    await expect(takeOverCurrentMap(f.matchId, f.entryAId, { ...reported, operatorReport: { ...refreshed.reportContext, reason: "已确认断网" } })).rejects.toThrow("采集状态已变化");
    expect((await loadSource(f.sessionId)).manualTakeoverMapEpoch).toBeNull();
  });

  it.each(["mapId", "mapName"])("persists wrong %s map_ended as REVIEW and completes through explicit takeover", async mismatch => {
    const fixture = await seedFixture();
    const wrong = reliableEvent(fixture, { kind: "map_ended", [mismatch]: mismatch === "mapId" ? fixture.mapTwoId : "de_mirage", payload: { scoreA: 13, scoreB: 9, scoreCT: 4, scoreT: 9 } });
    expect((await ingestMizarReliable(fixture.installationId, fixture.seasonId, wrong, fixture.authorityRevision)).outcome).toBe("needs_attention");
    expect(await loadSource(fixture.sessionId)).toMatchObject({ currentMapId: fixture.mapOneId, mapExecutionPhase: "gameplay", continuityHealth: "execution_conflict", autoCanonicalizationArmed: false });
    const rejectedContext = await operatorContext(fixture);
    expect(rejectedContext.review.evidence).toMatchObject({ mapName: wrong.mapName, scoreA: 13, scoreB: 9 });
    expect(rejectedContext.review.currentMap).toBe("Map 1 · Ancient");
    expect(rejectedContext.review.evidence?.mapBinding).toBe(mismatch === "mapId" ? "Map 2 · Mirage" : "Map 1 · Ancient");
    expect(await loadOperatorEvidence(fixture.seasonId, fixture.matchId, fixture.sessionId, 2)).toBeNull();
    expect(await loadOperatorEvidence(fixture.seasonId, fixture.matchId, randomUUID(), 1)).toBeNull();
    const correct = reliableEvent(fixture, { kind: "map_ended", payload: { scoreA: 13, scoreB: 9, scoreCT: 4, scoreT: 9 } });
    correct.cursor.runtimeSeq = 2;
    expect((await ingestMizarReliable(fixture.installationId, fixture.seasonId, correct, fixture.authorityRevision)).outcome).toBe("needs_attention");
    const context = await operatorContext(fixture);
    expect(context.review.evidence?.mapName).toBe(wrong.mapName);
    expect(context.review.evidence?.mapBinding).toBe(mismatch === "mapId" ? "Map 2 · Mirage" : "Map 1 · Ancient");
    expect(context.workflow).toMatchObject({ primaryTask: "review", reviewReasons: ["execution_mismatch"], manualResultAllowed: false });
    expect(context.takeover).toEqual({ sessionId: fixture.sessionId, mapEpoch: 1, mapId: fixture.mapOneId });
    await expect(db.transaction(tx => recordManualMapResultInTx(tx, manualCommand(fixture)))).rejects.toThrow("自动数据源");
    await takeOverCurrentMap(fixture.matchId, fixture.entryAId, context.takeover!);
    expect((await operatorContext(fixture)).workflow.manualResultAllowed).toBe(true);
    await db.transaction(tx => recordManualMapResultInTx(tx, manualCommand(fixture)));
    const between = await operatorContext(fixture);
    expect(between.workflow).toMatchObject({ primaryTask: "review", roomMapId: fixture.mapTwoId, focusMapId: fixture.mapOneId, manualResultAllowed: false });
    expect(between.workflow.title).toBe("Map 1 已记录 · 准备 Map 2");
    const late = reliableEvent(fixture, { kind: "map_ended", payload: { scoreA: 9, scoreB: 13, scoreCT: 9, scoreT: 13 } });
    late.cursor.runtimeSeq = 4;
    await ingestMizarReliable(fixture.installationId, fixture.seasonId, late, fixture.authorityRevision);
    expect((await operatorContext(fixture)).workflow.reviewReasons).toContain("result_conflict");
    await nextEpoch(fixture);
    expect((await operatorContext(fixture)).workflow).toMatchObject({ primaryTask: "observe", sourceHealth: "healthy", manualResultAllowed: false, elapsed: null });
    expect((await operatorContext(fixture)).review.evidence).toBeNull();
    late.cursor.runtimeSeq = 12;
    await expectCode(() => ingestMizarReliable(fixture.installationId, fixture.seasonId, late, fixture.authorityRevision), ErrorCode.VALIDATION_FAILED);
    const [official] = await db.select().from(schema.matchMaps).where(eq(schema.matchMaps.id, fixture.mapOneId));
    expect(official).toMatchObject({ scoreA: 13, scoreB: 9 });
    expect(await loadSource(fixture.sessionId)).toMatchObject({ currentMapId: fixture.mapTwoId, autoCanonicalizationArmed: true });
  });

  it("preserves a trusted execution after invalid map_started", async () => {
    const fixture = await seedFixture();
    await ingestMizarReliable(fixture.installationId, fixture.seasonId, reliableEvent(fixture, { mapId: fixture.mapTwoId, mapName: "de_mirage" }), fixture.authorityRevision, fixture.steam64);
    expect(await loadSource(fixture.sessionId)).toMatchObject({ currentMapId: fixture.mapOneId, mapExecutionPhase: "gameplay", continuityHealth: "execution_conflict" });
    expect((await operatorContext(fixture)).takeover).toEqual({ sessionId: fixture.sessionId, mapEpoch: 1, mapId: fixture.mapOneId });
  });

  it("recovers an unbound invalid start only by explicitly confirming the canonical pending map", async () => {
    const fixture = await seedFixture({ unboundSource: true });
    await ingestMizarReliable(fixture.installationId, fixture.seasonId, reliableEvent(fixture, { mapId: fixture.mapTwoId, mapName: "de_mirage" }), fixture.authorityRevision, fixture.steam64);
    expect(await loadSource(fixture.sessionId)).toMatchObject({ currentMapId: null, continuityHealth: "execution_conflict" });
    const context = await operatorContext(fixture);
    expect(context.workflow.primaryTask).toBe("review");
    expect(context.recoveryMapLabel).toBe("Map 1 · Ancient");
    const scope = context.takeover!;
    expect(scope).toEqual({ sessionId: fixture.sessionId, mapEpoch: 1, mapId: fixture.mapOneId, recoverMapBinding: true });
    await expect(takeOverCurrentMap(fixture.matchId, fixture.entryAId, { ...scope, recoverMapBinding: false })).rejects.toThrow("已变化");
    await expect(takeOverCurrentMap(fixture.matchId, fixture.entryAId, { ...scope, mapId: fixture.mapTwoId })).rejects.toThrow("重新核对");
    await expect(takeOverCurrentMap(fixture.matchId, fixture.entryAId, { ...scope, sessionId: randomUUID() })).rejects.toThrow("已变化");
    await expect(takeOverCurrentMap(fixture.matchId, fixture.entryAId, { ...scope, mapEpoch: 2 })).rejects.toThrow("已变化");
    await db.update(schema.matchVetoSessions).set({ completedAt: null }).where(eq(schema.matchVetoSessions.matchId, fixture.matchId));
    await expect(takeOverCurrentMap(fixture.matchId, fixture.entryAId, scope)).rejects.toThrow("BP 地图计划");
    await db.update(schema.matchVetoSessions).set({ completedAt: NOW }).where(eq(schema.matchVetoSessions.matchId, fixture.matchId));
    await takeOverCurrentMap(fixture.matchId, fixture.entryAId, scope);
    await takeOverCurrentMap(fixture.matchId, fixture.entryAId, scope);
    expect((await operatorContext(fixture)).workflow.manualResultAllowed).toBe(true);
    const audits = await db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.targetId, fixture.matchId), eq(schema.auditLogs.action, "mizar.map.manual_takeover")));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.meta).toMatchObject({ previousMapId: null, mapId: fixture.mapOneId, mapEpoch: 1, recoveredMapBinding: true });
    await db.transaction(tx => recordManualMapResultInTx(tx, manualCommand(fixture)));
    await expect(takeOverCurrentMap(fixture.matchId, fixture.entryAId, scope)).rejects.toThrow("正式赛果");
    await nextEpoch(fixture);
    expect((await operatorContext(fixture)).workflow).toMatchObject({ primaryTask: "observe", sourceHealth: "healthy" });
  });

  it("restores a lost binding after same-epoch source generation change while already manually taken over", async () => {
    const fixture = await seedFixture();
    await ingestMizarReliable(fixture.installationId, fixture.seasonId, reliableEvent(fixture, { kind: "identity_mismatch", payload: { reason: "operator review" } }), fixture.authorityRevision);
    const initial = (await operatorContext(fixture)).takeover!;
    await takeOverCurrentMap(fixture.matchId, fixture.entryAId, initial);
    const generation = reliableEvent(fixture, { kind: "source_generation_changed", payload: { previousSourceGeneration: 0 } });
    generation.cursor.runtimeSeq = 2;
    generation.cursor.programSourceGeneration = 1;
    await ingestMizarReliable(fixture.installationId, fixture.seasonId, generation, fixture.authorityRevision);
    expect(await loadSource(fixture.sessionId)).toMatchObject({ mapEpoch: 1, programSourceGeneration: 1, manualTakeoverMapEpoch: 1, currentMapId: null, autoCanonicalizationArmed: false });
    expect((await operatorContext(fixture)).takeover).toBeNull(); // unknown alone is not recovery authority
    await expect(db.transaction(tx => recordManualMapResultInTx(tx, manualCommand(fixture)))).rejects.toThrow("自动数据源");
    const ended = reliableEvent(fixture, { kind: "map_ended", payload: { scoreA: 13, scoreB: 9, scoreCT: 4, scoreT: 9 } });
    ended.cursor.runtimeSeq = 3;
    ended.cursor.programSourceGeneration = 1;
    expect((await ingestMizarReliable(fixture.installationId, fixture.seasonId, ended, fixture.authorityRevision)).outcome).toBe("needs_attention");
    const review = await operatorContext(fixture);
    expect(review.workflow).toMatchObject({ sourceMode: "manual_map", primaryTask: "review", manualResultAllowed: false });
    expect(review.takeover).toEqual({ sessionId: fixture.sessionId, mapEpoch: 1, mapId: fixture.mapOneId, recoverMapBinding: true });
    const scope = review.takeover!;
    await expect(takeOverCurrentMap(fixture.matchId, fixture.entryAId, { ...scope, sessionId: randomUUID() })).rejects.toThrow("已变化");
    await expect(takeOverCurrentMap(fixture.matchId, fixture.entryAId, { ...scope, mapEpoch: 2 })).rejects.toThrow("已变化");
    await expect(takeOverCurrentMap(fixture.matchId, fixture.entryAId, { ...scope, mapId: fixture.mapTwoId })).rejects.toThrow("重新核对");
    await expect(takeOverCurrentMap(fixture.matchId, fixture.entryAId, { ...scope, recoverMapBinding: false })).rejects.toThrow("已变化");
    await takeOverCurrentMap(fixture.matchId, fixture.entryAId, scope);
    await takeOverCurrentMap(fixture.matchId, fixture.entryAId, scope);
    const restored = await operatorContext(fixture);
    expect(restored.workflow.manualResultAllowed).toBe(true);
    expect(restored.takeover).toBeNull();
    const audits = await db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.targetId, fixture.matchId), eq(schema.auditLogs.action, "mizar.map.manual_takeover")));
    expect(audits).toHaveLength(2); // original takeover + one recovery, no duplicate audit
    expect(audits.find(row => (row.meta as { recoveredMapBinding?: boolean }).recoveredMapBinding)?.meta).toMatchObject({ previousMapId: null, mapId: fixture.mapOneId, mapEpoch: 1, programSourceGeneration: 1, previousManualTakeoverMapEpoch: 1, recoveredMapBinding: true });
    await db.transaction(tx => recordManualMapResultInTx(tx, manualCommand(fixture)));
    const [official] = await db.select().from(schema.matchMaps).where(eq(schema.matchMaps.id, fixture.mapOneId));
    expect(official).toMatchObject({ scoreA: 13, scoreB: 9 });
    expect(official!.completedAt).not.toBeNull();
    await expect(takeOverCurrentMap(fixture.matchId, fixture.entryAId, scope)).rejects.toThrow("正式赛果");
    const old = { ...ended, idempotencyKey: randomUUID(), cursor: { ...ended.cursor, runtimeSeq: 4, programSourceGeneration: 0 } };
    await expectCode(() => ingestMizarReliable(fixture.installationId, fixture.seasonId, old, fixture.authorityRevision), ErrorCode.VALIDATION_FAILED);
  });

  it("does not revive inter-map tasks after gameplay becomes stale and is manually taken over", async () => {
    const fixture = await seedFixture();
    await ingestMizarReliable(fixture.installationId, fixture.seasonId, reliableEvent(fixture, { kind: "map_ended", payload: { scoreA: 13, scoreB: 9, scoreCT: 4, scoreT: 9 } }), fixture.authorityRevision);
    expect((await operatorContext(fixture)).workflow.elapsed).not.toBeNull();
    const start = await nextEpoch(fixture);
    expect((await operatorContext(fixture)).workflow).toMatchObject({ phase: "gameplay", elapsed: null });
    const stale = { ...start, idempotencyKey: randomUUID(), cursor: { ...start.cursor, runtimeSeq: 12 }, evidence: { ...start.evidence, telemetryFresh: false } };
    await ingestMizarReliable(fixture.installationId, fixture.seasonId, stale, fixture.authorityRevision, fixture.steam64);
    const context = await operatorContext(fixture);
    expect(context.workflow).toMatchObject({ phase: "gameplay", sourceHealth: "stale", elapsed: null, roomMapId: null });
    await takeOverCurrentMap(fixture.matchId, fixture.entryAId, context.takeover!);
    const manual = await operatorContext(fixture);
    expect(manual.workflow).toMatchObject({ phase: "gameplay", primaryTask: "manual_result", elapsed: null, roomMapId: null });
    expect(manual.roomGuide).toBeNull();
    expect(manual.workflow.nextStep).not.toContain("准备");
    await db.transaction(tx => recordManualMapResultInTx(tx, manualCommand(fixture, 2)));
    expect((await operatorContext(fixture)).workflow).toMatchObject({ phase: "post", elapsed: null, roomMapId: null });
  });

  it("keeps the normal no-Mizar manual command and workbench path available", async () => {
    const fixture = await seedFixture();
    await releaseMizarSource(fixture.installationId, fixture.seasonId, { matchId: fixture.matchId, producerInstanceId: fixture.producerInstanceId, liveSessionId: fixture.liveSessionId }, fixture.authorityRevision);
    const context = await operatorContext(fixture);
    expect(context.workflow).toMatchObject({ sourceMode: "none", primaryTask: "manual_result", manualResultAllowed: true });
    expect(context.takeover).toBeNull();
    expect(JSON.stringify(context)).not.toMatch(/返回 Mizar|开播/);
    await db.transaction(tx => recordManualMapResultInTx(tx, manualCommand(fixture)));
    expect((await operatorContext(fixture)).workflow.completedMaps).toHaveLength(1);
  });

  it("canonicalizes an entrant-relative map_ended through the shared canonical result owner", async () => {
    const fixture = await seedFixture();
    const outcome = await ingestMizarReliable(
      fixture.installationId,
      fixture.seasonId,
      reliableEvent(fixture, { kind: "map_ended", payload: { scoreA: 13, scoreB: 9, scoreCT: 4, scoreT: 9 } }),
      fixture.authorityRevision,
    );
    expect(outcome).toEqual({ outcome: "canonicalized", duplicate: false });

    const [map] = await db.select().from(schema.matchMaps).where(eq(schema.matchMaps.id, fixture.mapOneId));
    expect([map!.scoreA, map!.scoreB]).toEqual([13, 9]);
    expect(map!.completedAt).not.toBeNull();
    const [match] = await db.select().from(schema.matches).where(eq(schema.matches.id, fixture.matchId));
    // Series score stays derived from map-level facts: a non-final map must never
    // write a series result, only the canonical map row above.
    expect([match!.scoreA, match!.scoreB]).toEqual([null, null]);
    expect(match!.status).toBe("in_progress");

    const source = await loadSource(fixture.sessionId);
    expect(source.lastReliableSeq).toBe(1);
    expect(source.mapExecutionPhase).toBe("inter_map");
    expect(source.autoCanonicalizationArmed).toBe(true);
  });

  it("keeps duplicate delivery idempotent and rejects conflicting content for one idempotency key", async () => {
    const fixture = await seedFixture();
    const event = reliableEvent(fixture, { kind: "map_ended", payload: { scoreA: 13, scoreB: 9, scoreCT: 4, scoreT: 9 } });
    await ingestMizarReliable(fixture.installationId, fixture.seasonId, event, fixture.authorityRevision);
    await expect(ingestMizarReliable(fixture.installationId, fixture.seasonId, event, fixture.authorityRevision))
      .resolves.toEqual({ outcome: "canonicalized", duplicate: true });
    await expectCode(
      () => ingestMizarReliable(fixture.installationId, fixture.seasonId, { ...event, payload: { scoreA: 13, scoreB: 8, scoreCT: 4, scoreT: 9 } }, fixture.authorityRevision),
      ErrorCode.VALIDATION_FAILED,
    );
    const receipts = await db.select().from(schema.mizarReliableReceipts).where(eq(schema.mizarReliableReceipts.sessionId, fixture.sessionId));
    expect(receipts).toHaveLength(1);
    expect(receipts[0]!.outcome).toBe("canonicalized");
  });

  it("fails closed on stale sequence, stale generation, stale epoch, wrong scope and unknown installation", async () => {
    const fixture = await seedFixture();
    await ingestMizarReliable(fixture.installationId, fixture.seasonId, reliableEvent(fixture, { cursor: { ...reliableEvent(fixture).cursor, runtimeSeq: 5 } }), fixture.authorityRevision);

    await expectCode(
      () => ingestMizarReliable(fixture.installationId, fixture.seasonId, reliableEvent(fixture, { cursor: { ...reliableEvent(fixture).cursor, runtimeSeq: 4 } }), fixture.authorityRevision),
      ErrorCode.VALIDATION_FAILED,
    );
    await expectCode(
      () => ingestMizarReliable(fixture.installationId, fixture.seasonId, reliableEvent(fixture, { cursor: { ...reliableEvent(fixture).cursor, runtimeSeq: 6, programSourceGeneration: 3 } }), fixture.authorityRevision),
      ErrorCode.VALIDATION_FAILED,
    );
    await expectCode(
      () => ingestMizarReliable(fixture.installationId, fixture.seasonId, reliableEvent(fixture, { cursor: { ...reliableEvent(fixture).cursor, runtimeSeq: 7, mapEpoch: 9 } }), fixture.authorityRevision),
      ErrorCode.VALIDATION_FAILED,
    );
    await expectCode(
      () => ingestMizarReliable(fixture.installationId, fixture.seasonId, reliableEvent(fixture, { competitionId: randomUUID() }), fixture.authorityRevision),
      ErrorCode.FORBIDDEN,
    );
    await expectCode(
      () => ingestMizarReliable(fixture.installationId, fixture.seasonId, reliableEvent(fixture, { entryAId: randomUUID() }), fixture.authorityRevision),
      ErrorCode.FORBIDDEN,
    );
    await expectCode(
      () => ingestMizarReliable(fixture.installationBId, fixture.seasonId, reliableEvent(fixture), fixture.authorityRevision),
      ErrorCode.FORBIDDEN,
    );
    await expectCode(
      () => ingestMizarReliable(fixture.installationId, fixture.seasonId, reliableEvent(fixture), fixture.authorityRevision + 5),
      ErrorCode.FORBIDDEN,
    );
  });

  it("disarms auto canonicalization on generation and epoch changes", async () => {
    const fixture = await seedFixture();
    const generation = await ingestMizarReliable(
      fixture.installationId,
      fixture.seasonId,
      reliableEvent(fixture, {
        kind: "source_generation_changed",
        cursor: { ...reliableEvent(fixture).cursor, runtimeSeq: 2, programSourceGeneration: 1 },
        payload: { previousSourceGeneration: 0 },
      }),
      fixture.authorityRevision,
    );
    expect(generation.outcome).toBe("observed");
    const afterGeneration = await loadSource(fixture.sessionId);
    expect(afterGeneration.programSourceGeneration).toBe(1);
    expect(afterGeneration.autoCanonicalizationArmed).toBe(false);
    expect(afterGeneration.mapExecutionPhase).toBe("waiting");
    expect(afterGeneration.currentMapId).toBeNull();

    const epoch = await ingestMizarReliable(
      fixture.installationId,
      fixture.seasonId,
      reliableEvent(fixture, {
        kind: "map_epoch_changed",
        cursor: { ...reliableEvent(fixture).cursor, runtimeSeq: 3, programSourceGeneration: 1, mapEpoch: 2 },
        payload: { previousMapEpoch: 1, reason: "producer-restart" },
      }),
      fixture.authorityRevision,
    );
    expect(epoch.outcome).toBe("observed");
    const afterEpoch = await loadSource(fixture.sessionId);
    expect(afterEpoch.mapEpoch).toBe(2);
    expect(afterEpoch.autoCanonicalizationArmed).toBe(false);
  });

  it("never lets series_ended advance a series whose canonical map results are missing", async () => {
    const fixture = await seedFixture();
    const outcome = await ingestMizarReliable(
      fixture.installationId,
      fixture.seasonId,
      reliableEvent(fixture, { kind: "series_ended", payload: { scoreA: 2, scoreB: 1 } }),
      fixture.authorityRevision,
    );
    expect(outcome.outcome).toBe("needs_attention");
    const [match] = await db.select().from(schema.matches).where(eq(schema.matches.id, fixture.matchId));
    expect(match!.status).toBe("in_progress");
    expect([match!.scoreA, match!.scoreB]).toEqual([null, null]);
    const maps = await db.select().from(schema.matchMaps).where(eq(schema.matchMaps.matchId, fixture.matchId));
    expect(maps.every((map) => map.scoreA === null && map.completedAt === null)).toBe(true);
    const source = await loadSource(fixture.sessionId);
    expect(source.continuityHealth).toBe("result_conflict");
    expect(source.autoCanonicalizationArmed).toBe(false);
  });

  it("marks identity and lineup mismatches as needs_attention and disarms the source", async () => {
    const identityFixture = await seedFixture();
    const identity = await ingestMizarReliable(
      identityFixture.installationId,
      identityFixture.seasonId,
      reliableEvent(identityFixture, { kind: "identity_mismatch", payload: { reason: null } }),
      identityFixture.authorityRevision,
    );
    expect(identity.outcome).toBe("needs_attention");
    const identitySource = await loadSource(identityFixture.sessionId);
    expect(identitySource.identityHealth).toBe("conflict");
    expect(identitySource.autoCanonicalizationArmed).toBe(false);

    const lineupFixture = await seedFixture();
    const lineup = await ingestMizarReliable(
      lineupFixture.installationId,
      lineupFixture.seasonId,
      reliableEvent(lineupFixture, { kind: "lineup_mismatch", payload: { reason: "unknown-starter" } }),
      lineupFixture.authorityRevision,
    );
    expect(lineup.outcome).toBe("needs_attention");
    expect((await loadSource(lineupFixture.sessionId)).lineupHealth).toBe("conflict");
  });

  it("records match_started as a reality primitive only when identity and lineup evidence agree", async () => {
    const fixture = await seedFixture({ matchStatus: "scheduled", freezeEventRoster: true });
    const observed = await ingestMizarReliable(
      fixture.installationId,
      fixture.seasonId,
      reliableEvent(fixture, { kind: "match_started" }),
      fixture.authorityRevision,
      fixture.steam64,
    );
    expect(observed.outcome).toBe("canonicalized");
    const [match] = await db.select().from(schema.matches).where(eq(schema.matches.id, fixture.matchId));
    expect(match!.status).toBe("in_progress");
    expect(match!.startedAt).not.toBeNull();
    const source = await loadSource(fixture.sessionId);
    expect([source.identityHealth, source.lineupHealth, source.continuityHealth]).toEqual(["healthy", "healthy", "healthy"]);
    const audits = await db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.seasonId, fixture.seasonId), eq(schema.auditLogs.action, "match.start.reality_warning")));
    expect(audits).toHaveLength(1);

    const mismatch = await seedFixture({ matchStatus: "scheduled", freezeEventRoster: true });
    const needsAttention = await ingestMizarReliable(
      mismatch.installationId,
      mismatch.seasonId,
      reliableEvent(mismatch, { kind: "match_started" }),
      mismatch.authorityRevision,
      [mismatch.steam64[0]!],
    );
    expect(needsAttention.outcome).toBe("needs_attention");
    const [stillScheduled] = await db.select().from(schema.matches).where(eq(schema.matches.id, mismatch.matchId));
    expect(stillScheduled!.status).toBe("scheduled");
    expect((await loadSource(mismatch.sessionId)).lineupHealth).toBe("conflict");
  });

  it("rejects a reliable event whose arming map no longer matches the canonical map plan", async () => {
    const fixture = await seedFixture();
    const armed = await ingestMizarReliable(fixture.installationId, fixture.seasonId, reliableEvent(fixture), fixture.authorityRevision, fixture.steam64);
    expect(armed.outcome).toBe("armed");
    expect((await loadSource(fixture.sessionId)).currentMapId).toBe(fixture.mapOneId);

    const wrongMap = await ingestMizarReliable(
      fixture.installationId,
      fixture.seasonId,
      reliableEvent(fixture, { cursor: { ...reliableEvent(fixture).cursor, runtimeSeq: 2 }, mapName: "de_mirage", mapId: null }),
      fixture.authorityRevision,
    );
    expect(wrongMap.outcome).toBe("needs_attention");
    const source = await loadSource(fixture.sessionId);
    expect(source.currentMapId).toBe(fixture.mapOneId);
    expect(source.continuityHealth).toBe("execution_conflict");
    expect(source.autoCanonicalizationArmed).toBe(false);
  });
});

describe("Mizar live snapshot ingest boundary", () => {
  function snapshot(fixture: Fixture, overrides: Record<string, unknown> = {}) {
    return {
      schemaVersion: "mizar.live-snapshot.v1",
      cursor: { producerInstanceId: fixture.producerInstanceId, liveSessionId: fixture.liveSessionId, runtimeSeq: 1, programSourceGeneration: 0, programReceiveSequence: 1, mapEpoch: 1 },
      producedAt: NOW.toISOString(),
      matchId: fixture.matchId,
      competitionId: fixture.seasonId,
      format: "bo3",
      series: { scoreA: 0, scoreB: 0, currentMapOrder: 1 },
      roundHistory: null,
      map: { mapId: fixture.mapOneId, name: "de_ancient", phase: "live", roundNumber: 1, scoreCT: 4, scoreT: 2 },
      roundPhase: "live",
      clock: null,
      teams: { ct: { entryId: fixture.entryAId, name: "Provider A" }, t: { entryId: fixture.entryBId, name: "Provider B" } },
      players: [],
      observedPlayerSourceId: null,
      bomb: null,
      radar: null,
      capability: { telemetryFresh: true, contextFresh: true, identity: "matched", lineupComplete: true, radarCurrent: true, canonicalTeams: true },
      ...overrides,
    };
  }

  it("validates the active source and only then reaches the Broadcast transport", async () => {
    const fixture = await seedFixture();
    const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const previousKey = process.env.SUPABASE_SECRET_KEY;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:1";
    process.env.SUPABASE_SECRET_KEY = "integration-test-service-key";
    try {
      // Transport availability is not part of this boundary. A healthy frame must pass
      // authorization and only then degrade or fail at Broadcast, never before it.
      const outcome = await ingestMizarLive(fixture.installationId, fixture.seasonId, snapshot(fixture), fixture.authorityRevision)
        .catch((error: unknown) => error);
      expect(outcome).not.toBeInstanceOf(AppError);
    } finally {
      if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
      if (previousKey === undefined) delete process.env.SUPABASE_SECRET_KEY;
      else process.env.SUPABASE_SECRET_KEY = previousKey;
    }
  });

  it("fails closed for stale sequence, stale epoch, stale generation and wrong scope", async () => {
    const fixture = await seedFixture();
    await db.update(schema.matchLiveSessions).set({ lastReliableSeq: 5 }).where(eq(schema.matchLiveSessions.id, fixture.sessionId));
    await expectCode(
      () => ingestMizarLive(fixture.installationId, fixture.seasonId, snapshot(fixture, { cursor: { ...snapshot(fixture).cursor, runtimeSeq: 1 } }), fixture.authorityRevision),
      ErrorCode.FORBIDDEN,
    );
    // Restore the water mark so the remaining cases exercise their own boundary.
    await db.update(schema.matchLiveSessions).set({ lastReliableSeq: -1 }).where(eq(schema.matchLiveSessions.id, fixture.sessionId));
    await expectCode(
      () => ingestMizarLive(fixture.installationId, fixture.seasonId, snapshot(fixture, { cursor: { ...snapshot(fixture).cursor, mapEpoch: 4 } }), fixture.authorityRevision),
      ErrorCode.FORBIDDEN,
    );
    await expectCode(
      () => ingestMizarLive(fixture.installationId, fixture.seasonId, snapshot(fixture, { cursor: { ...snapshot(fixture).cursor, programSourceGeneration: 4 } }), fixture.authorityRevision),
      ErrorCode.FORBIDDEN,
    );
    await expectCode(
      () => ingestMizarLive(fixture.installationBId, fixture.seasonId, snapshot(fixture), fixture.authorityRevision),
      ErrorCode.FORBIDDEN,
    );
    await expectCode(
      () => ingestMizarLive(fixture.installationId, fixture.seasonId, snapshot(fixture, { competitionId: randomUUID() }), fixture.authorityRevision),
      ErrorCode.FORBIDDEN,
    );
    await expectCode(
      () => ingestMizarLive(fixture.installationId, fixture.seasonId, snapshot(fixture, { teams: { ct: { entryId: fixture.entryAId, name: "A" }, t: { entryId: fixture.entryAId, name: "A" } } }), fixture.authorityRevision),
      ErrorCode.VALIDATION_FAILED,
    );
  });

  it("fails closed when identity, lineup, telemetry or context health is not proven", async () => {
    const fixture = await seedFixture();
    await db.update(schema.matchLiveSessions).set({ identityHealth: "conflict" }).where(eq(schema.matchLiveSessions.id, fixture.sessionId));
    await expectCode(
      () => ingestMizarLive(fixture.installationId, fixture.seasonId, snapshot(fixture), fixture.authorityRevision),
      ErrorCode.FORBIDDEN,
    );
    await db.update(schema.matchLiveSessions).set({ identityHealth: "healthy" }).where(eq(schema.matchLiveSessions.id, fixture.sessionId));
    const staleTelemetry = snapshot(fixture, { capability: { ...snapshot(fixture).capability, telemetryFresh: false } });
    await expectCode(
      () => ingestMizarLive(fixture.installationId, fixture.seasonId, staleTelemetry, fixture.authorityRevision),
      ErrorCode.FORBIDDEN,
    );
  });

  it("fails closed for a revoked installation even with a valid credential shape", async () => {
    const fixture = await seedFixture();
    await db.update(schema.mizarInstallations).set({ revokedAt: NOW }).where(eq(schema.mizarInstallations.id, fixture.installationId));
    await expectCode(
      () => ingestMizarLive(fixture.installationId, fixture.seasonId, snapshot(fixture), fixture.authorityRevision),
      ErrorCode.FORBIDDEN,
    );
  });
});

describe("Mizar source authority", () => {
  it("keeps one authoritative source per match and fails the previous source closed after takeover", async () => {
    const fixture = await seedFixture();
    const context = await db.transaction((tx) => loadMizarMatchDocumentInTx(tx, fixture.matchId, fixture.seasonId));

    const second = await claimMizarSource(fixture.installationBId, fixture.seasonId, {
      matchId: fixture.matchId,
      producerInstanceId: "producer-b",
      liveSessionId: "live-b",
      programSourceGeneration: 0,
      mapEpoch: 1,
      contextRevision: context.revision,
      takeover: false,
      lineupSteam64: [],
    });
    expect(second.claimed).toBe(false);
    expect(second.activeDeviceName).toBeTruthy();

    const takeover = await claimMizarSource(fixture.installationBId, fixture.seasonId, {
      matchId: fixture.matchId,
      producerInstanceId: "producer-b",
      liveSessionId: "live-b",
      programSourceGeneration: 0,
      mapEpoch: 1,
      contextRevision: context.revision,
      takeover: true,
      lineupSteam64: [],
    });
    expect(takeover).toEqual({ claimed: true, authorityRevision: 2 });

    const open = await db.select().from(schema.matchLiveSessions).where(and(eq(schema.matchLiveSessions.matchId, fixture.matchId), isNull(schema.matchLiveSessions.closedAt)));
    expect(open).toHaveLength(1);
    expect(open[0]!.installationId).toBe(fixture.installationBId);
    const closed = await db.select().from(schema.matchLiveSessions).where(eq(schema.matchLiveSessions.id, fixture.sessionId));
    expect(closed[0]!.closeReason).toBe("handover");
    expect(closed[0]!.autoCanonicalizationArmed).toBe(false);

    // The replaced source keeps a valid credential but is no longer authoritative.
    await expectCode(
      () => ingestMizarReliable(fixture.installationId, fixture.seasonId, reliableEvent(fixture, { kind: "map_ended", payload: { scoreA: 13, scoreB: 9, scoreCT: 4, scoreT: 9 } }), fixture.authorityRevision),
      ErrorCode.FORBIDDEN,
    );
    await expectCode(
      () => ingestMizarLive(fixture.installationId, fixture.seasonId, snapshotForAuthority(fixture), fixture.authorityRevision),
      ErrorCode.FORBIDDEN,
    );
  });

  it("fails an old producer release closed after same-installation takeover and keeps exact retries idempotent", async () => {
    const fixture = await seedFixture();
    const context = await db.transaction((tx) => loadMizarMatchDocumentInTx(tx, fixture.matchId, fixture.seasonId));
    const takeover = await claimMizarSource(fixture.installationId, fixture.seasonId, {
      matchId: fixture.matchId,
      producerInstanceId: "producer-new",
      liveSessionId: "live-new",
      programSourceGeneration: 0,
      mapEpoch: 1,
      contextRevision: context.revision,
      takeover: true,
      lineupSteam64: [],
    });
    expect(takeover).toEqual({ claimed: true, authorityRevision: 2 });

    await expectCode(
      () => releaseMizarSource(fixture.installationId, fixture.seasonId, {
        matchId: fixture.matchId,
        producerInstanceId: fixture.producerInstanceId,
        liveSessionId: fixture.liveSessionId,
      }, fixture.authorityRevision),
      ErrorCode.FORBIDDEN,
    );
    const [active] = await db.select().from(schema.matchLiveSessions).where(and(
      eq(schema.matchLiveSessions.matchId, fixture.matchId),
      isNull(schema.matchLiveSessions.closedAt),
    ));
    expect(active).toMatchObject({
      installationId: fixture.installationId,
      producerInstanceId: "producer-new",
      liveSessionId: "live-new",
      authorityRevision: 2,
    });

    const release = () => releaseMizarSource(fixture.installationId, fixture.seasonId, {
      matchId: fixture.matchId,
      producerInstanceId: "producer-new",
      liveSessionId: "live-new",
    }, 2);
    await release();
    await expect(release()).resolves.toBeUndefined();
    const [released] = await db.select().from(schema.matchLiveSessions).where(eq(schema.matchLiveSessions.id, active!.id));
    expect(released!.closeReason).toBe("released");
  });

  it("releases an active source so a fresh authority revision can claim the match", async () => {
    const fixture = await seedFixture();
    const context = await db.transaction((tx) => loadMizarMatchDocumentInTx(tx, fixture.matchId, fixture.seasonId));
    await releaseMizarSource(fixture.installationId, fixture.seasonId, {
      matchId: fixture.matchId,
      producerInstanceId: fixture.producerInstanceId,
      liveSessionId: fixture.liveSessionId,
    }, fixture.authorityRevision);
    const released = await loadSource(fixture.sessionId);
    expect(released.closedAt).not.toBeNull();
    expect(released.closeReason).toBe("released");

    const claimed = await claimMizarSource(fixture.installationBId, fixture.seasonId, {
      matchId: fixture.matchId,
      producerInstanceId: "producer-b",
      liveSessionId: "live-b",
      programSourceGeneration: 0,
      mapEpoch: 1,
      contextRevision: context.revision,
      takeover: false,
      lineupSteam64: [],
    });
    expect(claimed).toEqual({ claimed: true, authorityRevision: 2 });
  });

  it("scopes manual takeover to the current map execution and blocks automatic canonicalization for that epoch", async () => {
    const fixture = await seedFixture();
    const scope = { sessionId: fixture.sessionId, mapId: fixture.mapOneId, mapEpoch: (await loadSource(fixture.sessionId)).mapEpoch };
    await db.update(schema.matchLiveSessions).set({ currentMapId: fixture.mapOneId, identityHealth: "conflict" }).where(eq(schema.matchLiveSessions.id, fixture.sessionId));
    await expect(takeOverCurrentMap(fixture.matchId, fixture.entryAId, { ...scope, mapEpoch: scope.mapEpoch + 1 })).rejects.toThrow("已变化");
    await takeOverCurrentMap(fixture.matchId, fixture.entryAId, scope);
    await takeOverCurrentMap(fixture.matchId, fixture.entryAId, scope);
    const source = await loadSource(fixture.sessionId);
    expect(source.manualTakeoverMapEpoch).toBe(source.mapEpoch);
    expect(source.autoCanonicalizationArmed).toBe(false);

    await db.update(schema.matchLiveSessions).set({ autoCanonicalizationArmed: true }).where(eq(schema.matchLiveSessions.id, fixture.sessionId));
    const outcome = await ingestMizarReliable(
      fixture.installationId,
      fixture.seasonId,
      reliableEvent(fixture, { kind: "map_ended", payload: { scoreA: 13, scoreB: 9, scoreCT: 4, scoreT: 9 } }),
      fixture.authorityRevision,
    );
    expect(outcome.outcome).toBe("needs_attention");
    const [map] = await db.select().from(schema.matchMaps).where(eq(schema.matchMaps.id, fixture.mapOneId));
    expect(map!.scoreA).toBeNull();
    await db.update(schema.matchLiveSessions).set({ autoCanonicalizationArmed: false }).where(eq(schema.matchLiveSessions.id, fixture.sessionId));
    const command = { matchId: fixture.matchId, mapOrder: 1, mapName: "de_ancient", scoreA: 13, scoreB: 9, actorId: fixture.entryAId, pickedByEntryId: null, teamAStartSide: null };
    await db.transaction(tx => recordManualMapResultInTx(tx, command));
    await expect(db.transaction(tx => recordManualMapResultInTx(tx, command))).rejects.toThrow("已录入");
    await expect(takeOverCurrentMap(fixture.matchId, fixture.entryAId, scope)).rejects.toThrow("正式赛果");
    const [official] = await db.select().from(schema.matchMaps).where(eq(schema.matchMaps.id, fixture.mapOneId));
    expect(official!.scoreA).toBe(13);
    await ingestMizarReliable(fixture.installationId, fixture.seasonId, reliableEvent(fixture, { kind: "map_ended", payload: { scoreA: 9, scoreB: 13, scoreCT: 9, scoreT: 13 } }), fixture.authorityRevision);
    expect((await loadSource(fixture.sessionId)).continuityHealth).toBe("result_conflict");
    const [unchanged] = await db.select().from(schema.matchMaps).where(eq(schema.matchMaps.id, fixture.mapOneId));
    expect(unchanged!.scoreA).toBe(13);
  });
  it("separates explicit stale evidence from identity conflict and rearms only a healthy next epoch", async () => {
    const fixture = await seedFixture();
    const stale = reliableEvent(fixture, { kind: "map_started" });
    stale.evidence.telemetryFresh = false;
    await ingestMizarReliable(fixture.installationId, fixture.seasonId, stale, fixture.authorityRevision, fixture.steam64);
    const source = await loadSource(fixture.sessionId);
    expect(source.identityHealth).toBe("healthy");
    expect(source.continuityHealth).toBe("stale");
    await takeOverCurrentMap(fixture.matchId, fixture.entryAId, { sessionId: fixture.sessionId, mapEpoch: source.mapEpoch, mapId: fixture.mapOneId });
    await db.transaction(tx => recordManualMapResultInTx(tx, { matchId: fixture.matchId, mapOrder: 1, mapName: "de_ancient", scoreA: 13, scoreB: 9, actorId: fixture.entryAId, pickedByEntryId: null, teamAStartSide: null }));
    const epoch = reliableEvent(fixture, { kind: "map_epoch_changed", idempotencyKey: "next-epoch", payload: { previousMapEpoch: 1, reason: "next map" } });
    epoch.cursor.mapEpoch = 2;
    epoch.cursor.runtimeSeq = 2;
    await ingestMizarReliable(fixture.installationId, fixture.seasonId, epoch, fixture.authorityRevision);
    const start = reliableEvent(fixture, { kind: "map_started", idempotencyKey: "next-start", mapId: fixture.mapTwoId, mapName: "de_mirage" });
    start.cursor.mapEpoch = 2;
    start.cursor.runtimeSeq = 3;
    await ingestMizarReliable(fixture.installationId, fixture.seasonId, start, fixture.authorityRevision, fixture.steam64);
    expect(await loadSource(fixture.sessionId)).toMatchObject({ autoCanonicalizationArmed: true, currentMapId: fixture.mapTwoId, mapEpoch: 2, manualTakeoverMapEpoch: 1 });
  });
  it("rejects manual results while AUTO owns the current execution", async () => {
    const fixture = await seedFixture();
    await expect(db.transaction(tx => recordManualMapResultInTx(tx, { matchId: fixture.matchId, mapOrder: 1, mapName: "de_ancient", scoreA: 13, scoreB: 9, actorId: fixture.entryAId, pickedByEntryId: null, teamAStartSide: null }))).rejects.toThrow("自动数据源");
  });
});

describe("Tournament Context provider ownership", () => {
  it("projects public-safe facts with the canonical event logoUrl and no private lineage", async () => {
    const fixture = await seedFixture();
    await db.update(schema.seasons).set({ logoUrl: "https://example.test/logo.png" }).where(eq(schema.seasons.id, fixture.seasonId));
    const document = await db.transaction((tx) => loadMizarMatchDocumentInTx(tx, fixture.matchId, fixture.seasonId));
    expect(document.schemaVersion).toBe("rivalhub.broadcast-manifest.v1");
    expect(document.match.competition.logoUrl).toBe("https://example.test/logo.png");
    expect(document.entrants.a.roster.players).toHaveLength(5);
    expect(document.entrants.a.roster.players.every((player) => player.isStarter)).toBe(true);
    expect(document.maps.map((map) => map.mapName)).toEqual(["de_ancient", "de_mirage"]);
    expect(document.revision).toHaveLength(64);

    const serialized = JSON.stringify(document);
    for (const forbidden of ["private-review-marker", "private-perfect-marker", "@local.test", "credentialHash", "installationId", "reviewReason"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("keeps substitution evidence and a null Steam64 visible to the provider without inventing identity", async () => {
    const fixture = await seedFixture();
    const substitute = randomUUID();
    await db.insert(schema.users).values({ id: substitute, email: `${substitute}@local.test` });
    const eventRoster = await db.select({ id: schema.eventRosters.id }).from(schema.eventRosters).where(eq(schema.eventRosters.entryId, fixture.entryAId));
    await db.insert(schema.eventRosterMembers).values({ id: randomUUID(), eventRosterId: eventRoster[0]!.id, userId: substitute, isPrimaryStarter: false });
    const roster = await db.select({ id: schema.matchRosters.id }).from(schema.matchRosters).where(eq(schema.matchRosters.entryId, fixture.entryAId));
    const [member] = await db.select({ id: schema.eventRosterMembers.id }).from(schema.eventRosterMembers).where(eq(schema.eventRosterMembers.userId, substitute));
    await db.insert(schema.matchRosterPlayers).values({ rosterId: roster[0]!.id, eventRosterMemberId: member!.id, isStarter: false });

    const document = await db.transaction((tx) => loadMizarMatchDocumentInTx(tx, fixture.matchId, fixture.seasonId));
    const projected = document.entrants.a.roster.players.find((player) => player.playerId === substitute);
    expect(projected).toBeDefined();
    expect(projected!.isStarter).toBe(false);
    expect(projected!.steam64).toBeNull();
  });
});

function snapshotForAuthority(fixture: Fixture) {
  return {
    schemaVersion: "mizar.live-snapshot.v1",
    cursor: { producerInstanceId: fixture.producerInstanceId, liveSessionId: fixture.liveSessionId, runtimeSeq: 3, programSourceGeneration: 0, programReceiveSequence: 3, mapEpoch: 1 },
    producedAt: NOW.toISOString(),
    matchId: fixture.matchId,
    competitionId: fixture.seasonId,
    format: "bo3",
    series: { scoreA: 0, scoreB: 0, currentMapOrder: 1 },
    roundHistory: null,
    map: { mapId: fixture.mapOneId, name: "de_ancient", phase: "live", roundNumber: 1, scoreCT: 4, scoreT: 2 },
    roundPhase: "live",
    clock: null,
    teams: { ct: { entryId: fixture.entryAId, name: "Provider A" }, t: { entryId: fixture.entryBId, name: "Provider B" } },
    players: [],
    observedPlayerSourceId: null,
    bomb: null,
    radar: null,
    capability: { telemetryFresh: true, contextFresh: true, identity: "matched", lineupComplete: true, radarCurrent: true, canonicalTeams: true },
  };
}

describe("operator repair before manual fallback", () => {
  it.each([false, true])("revalidates a correct newer start after wrong room (unbound=%s), protects late/duplicate results and rearms next map", async unboundSource => {
    const f = await seedFixture({ unboundSource });
    const wrong = reliableEvent(f, { mapId: f.mapTwoId, mapName: "de_mirage" });
    await ingestMizarReliable(f.installationId, f.seasonId, wrong, f.authorityRevision, f.steam64);
    const correct = reliableEvent(f);
    // Same-cursor observations cannot erase a recorded conflict.
    expect((await ingestMizarReliable(f.installationId, f.seasonId, correct, f.authorityRevision, f.steam64)).outcome).toBe("needs_attention");
    correct.idempotencyKey = randomUUID(); correct.cursor.runtimeSeq = 2;
    expect((await ingestMizarReliable(f.installationId, f.seasonId, correct, f.authorityRevision, f.steam64)).outcome).toBe("armed");
    expect((await operatorContext(f)).workflow).toMatchObject({ primaryTask: "observe", sourceHealth: "healthy", manualResultAllowed: false });
    expect((await operatorContext(f)).takeover).toBeNull();
    await expect(ingestMizarReliable(f.installationId, f.seasonId, { ...wrong, idempotencyKey: randomUUID() }, f.authorityRevision, f.steam64)).rejects.toThrow("过期");
    const end = reliableEvent(f, { kind: "map_ended", payload: { scoreA: 13, scoreB: 9, scoreCT: 4, scoreT: 9 } }); end.cursor.runtimeSeq = 3;
    expect((await ingestMizarReliable(f.installationId, f.seasonId, end, f.authorityRevision)).outcome).toBe("canonicalized");
    expect((await ingestMizarReliable(f.installationId, f.seasonId, end, f.authorityRevision)).duplicate).toBe(true);
    await nextEpoch(f);
    expect((await operatorContext(f)).workflow.primaryTask).toBe("observe");
    const audits = await db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.targetId, f.matchId), eq(schema.auditLogs.action, "mizar.map.revalidated")));
    expect(audits).toHaveLength(1);
  });

  it("keeps an explicit manual choice during correct same-epoch observations and exposes the observed player differences", async () => {
    const f = await seedFixture();
    const observed = [...f.steam64]; observed[0] = testSteam64(randomUUID()); observed[1] = observed[2]!;
    await ingestMizarReliable(f.installationId, f.seasonId, reliableEvent(f, { kind: "lineup_mismatch", payload: { reason: "lineup_changed" } }), f.authorityRevision, observed);
    await db.insert(schema.steamProfiles).values([
      { steam64: f.steam64[0]!, personaName: "Steam 首发昵称", profileUrl: `https://steamcommunity.com/profiles/${f.steam64[0]}`, fetchedAt: new Date() },
      { steam64: observed[0]!, personaName: "Steam 额外玩家", profileUrl: `https://steamcommunity.com/profiles/${observed[0]}`, fetchedAt: new Date() },
    ]).onConflictDoNothing();
    const context = await operatorContext(f);
    expect(context.review.evidence?.lineupDifference?.missing.find(player => player.steam64 === f.steam64[0])?.name).toBe("Steam 首发昵称");
    expect(context.review.evidence?.lineupDifference).toMatchObject({ missing: expect.arrayContaining([expect.objectContaining({ steam64: f.steam64[0] }), expect.objectContaining({ steam64: f.steam64[1] })]), unexpected: [expect.objectContaining({ steam64: observed[0], name: "Steam 额外玩家", profileUrl: `https://steamcommunity.com/profiles/${observed[0]}` })], duplicated: [expect.objectContaining({ steam64: observed[2], name: "待识别玩家" })] });
    await takeOverCurrentMap(f.matchId, f.entryAId, context.takeover!);
    const start = reliableEvent(f); start.cursor.runtimeSeq = 2;
    await ingestMizarReliable(f.installationId, f.seasonId, start, f.authorityRevision, f.steam64);
    expect((await operatorContext(f)).workflow).toMatchObject({ sourceMode: "manual_map", manualResultAllowed: true });
    await db.transaction(tx => recordManualMapResultInTx(tx, manualCommand(f)));
    await nextEpoch(f);
    expect((await operatorContext(f)).workflow.sourceMode).toBe("mizar_auto");
  });
});

describe("operator authorization and in-progress score correction", () => {
  it("restricts peer revocation while allowing audited super-admin intervention and self disconnect", async () => {
    const { revokeMizarInstallation } = await import("../../../src/lib/mizar/installation");
    const f = await seedFixture();
    const peer = randomUUID(), superAdmin = randomUUID();
    await db.insert(schema.users).values([{ id: peer, email: `${peer}@local.test`, role: "user" }, { id: superAdmin, email: `${superAdmin}@local.test`, role: "super_admin" }]);
    await db.insert(schema.seasonAdminGrants).values({ userId: peer, seasonId: f.seasonId });
    await expect(revokeMizarInstallation(f.installationId, f.seasonId, peer, "test")).rejects.toThrow("授权人");
    expect((await loadSource(f.sessionId)).closedAt).toBeNull();
    await expect(revokeMizarInstallation(f.installationId, f.seasonId, superAdmin)).rejects.toThrow("原因");
    await revokeMizarInstallation(f.installationId, f.seasonId, superAdmin, "设备遗失，撤销授权");
    expect((await loadSource(f.sessionId)).closeReason).toBe("revoked");
    const audits = await db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.targetId, f.installationId), eq(schema.auditLogs.action, "mizar.installation.revoke")));
    expect(audits[0]?.meta).toMatchObject({ reason: "设备遗失，撤销授权" });
    await revokeMizarInstallation(f.installationId, f.seasonId, f.installationId);
  });

  it("corrects a completed map during the next map, checks reviewed scores, and retains epoch/official completion", async () => {
    const { correctMapScoreInTx } = await import("../../../src/lib/matches/map-score-correction");
    const f = await seedFixture();
    await ingestMizarReliable(f.installationId, f.seasonId, reliableEvent(f, { kind: "map_ended", payload: { scoreA: 13, scoreB: 9, scoreCT: 4, scoreT: 9 } }), f.authorityRevision);
    await nextEpoch(f);
    const before = (await db.select().from(schema.matchMaps).where(eq(schema.matchMaps.id, f.mapOneId)))[0]!;
    const input = { matchId: f.matchId, mapId: f.mapOneId, scoreA: 13, scoreB: 10, actorId: f.entryAId, review: { expectedScoreA: 13, expectedScoreB: 9, reason: "对照 Perfect 更正" } };
    await db.transaction(tx => correctMapScoreInTx(tx, input));
    await db.transaction(tx => correctMapScoreInTx(tx, input));
    expect((await loadSource(f.sessionId))).toMatchObject({ currentMapId: f.mapTwoId, mapEpoch: 2, autoCanonicalizationArmed: true });
    expect((await db.select().from(schema.matchMaps).where(eq(schema.matchMaps.id, f.mapOneId)))[0]).toMatchObject({ scoreA: 13, scoreB: 10, completedAt: before.completedAt });
    await expect(db.transaction(tx => correctMapScoreInTx(tx, { ...input, scoreB: 11 }))).rejects.toThrow("已更新");
    await expect(db.transaction(tx => correctMapScoreInTx(tx, { ...input, mapId: f.mapTwoId }))).rejects.toThrow("先提交");
    await expect(db.transaction(tx => correctMapScoreInTx(tx, { ...input, review: { ...input.review, reason: "" } }))).rejects.toThrow();
    const audits = await db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.targetId, f.matchId), eq(schema.auditLogs.action, "match.correct_map_score")));
    expect(audits).toHaveLength(1);
    expect((await operatorContext(f)).workflow).toMatchObject({ phase: "gameplay", elapsed: null });
  });
});
