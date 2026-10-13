import { randomUUID } from "node:crypto";
import { eq, isNull, and } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { loadMizarMatchDocument } from "@/lib/mizar/context";
import { claimMizarSource, releaseMizarSource } from "@/lib/mizar/source";
import { ingestMizarReliable } from "@/lib/mizar/reliable";
import { ingestMizarLive } from "@/lib/mizar/live";
import { parseLiveSnapshotV1, type LiveSnapshotV1 } from "@/lib/mizar/protocol";
import { projectPublicLive } from "@/lib/mizar/live-projection";
import { parsePublicLiveProjection } from "@/lib/mizar/live-viewer-state";
import { loadPublicMatchPhase } from "@/lib/matches/public-phase";
import { loadEffectiveMatchRoster } from "@/lib/match-rosters/effective";
import { AppError, ErrorCode } from "@/lib/errors";
import fixture from "../../fixtures/contracts/mizar-live-real-derived.json";
import { seedFixture, type Fixture } from "./harness/mizar";

// Protect the new cross-boundary promise with real transactions: showing temporary
// accounts must neither change the roster nor authorize a result/settlement.
async function observedFixture() {
  const f = await seedFixture({ unboundSource: true });
  const roster = await loadEffectiveMatchRoster(db, [f.matchId]);
  const ids = [...f.steam64];
  ids[0] = "76561190000000001";
  ids[5] = "76561190000000002";
  await releaseMizarSource(f.installationId, f.seasonId, f, f.authorityRevision);
  f.contextRevision = (await loadMizarMatchDocument(f.matchId, f.seasonId)).revision;
  const claim = { ...f, programSourceGeneration: 0, mapEpoch: 1, lineupSteam64: ids };
  // The domain parser is strict; pass only the request fields.
  const input = { matchId: claim.matchId, producerInstanceId: claim.producerInstanceId, liveSessionId: claim.liveSessionId,
    contextRevision: claim.contextRevision, programSourceGeneration: 0, mapEpoch: 1, lineupSteam64: ids };
  await expect(claimMizarSource(f.installationId, f.seasonId, input)).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
  await expect(claimMizarSource(f.installationId, f.seasonId, { ...input, allowLineupMismatch: true, lineupSteam64: [...ids.slice(0, 9), ids[0]!] })).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
  const result = await claimMizarSource(f.installationId, f.seasonId, { ...input, allowLineupMismatch: true });
  expect(result.claimed).toBe(true);
  f.authorityRevision = result.authorityRevision;
  const snapshot = parseLiveSnapshotV1(fixture.snapshot);
  snapshot.matchId = f.matchId; snapshot.competitionId = f.seasonId; snapshot.format = "bo3";
  snapshot.producedAt = new Date().toISOString();
  snapshot.cursor = { producerInstanceId: f.producerInstanceId, liveSessionId: f.liveSessionId, runtimeSeq: 1, programSourceGeneration: 0, programReceiveSequence: 1, mapEpoch: 1 };
  snapshot.map = { ...snapshot.map, mapId: f.mapOneId, name: "de_ancient", phase: "live" };
  snapshot.series = { scoreA: 0, scoreB: 0, currentMapOrder: 1 }; snapshot.radar = null; snapshot.roundHistory = null;
  snapshot.teams = { ct: { entryId: f.entryAId, name: "Provider A" }, t: { entryId: f.entryBId, name: "Provider B" } };
  snapshot.capability = { telemetryFresh: true, contextFresh: true, identity: "degraded", lineupComplete: true, canonicalTeams: true, radarCurrent: false, lineupMismatchOnly: true };
  snapshot.players = snapshot.players.slice(0, 10).map((player, index) => ({ ...player, sourcePlayerId: ids[index]!,
    canonicalPlayerId: roster.find(row => row.steam64 === f.steam64[index])!.userId,
    displayName: index === 0 || index === 5 ? "临时账号" : player.displayName,
    identityEvidence: index === 0 || index === 5 ? "observed" : "canonical", lineupEvidence: "current", side: index < 5 ? "CT" : "T" }));
  return { f, ids, roster, snapshot };
}
function event(f: Fixture, snapshot: LiveSnapshotV1, kind = "map_started", sequence = 1) {
  return { schemaVersion: "mizar.reliable-event.v1", idempotencyKey: randomUUID(), cursor: { ...snapshot.cursor, runtimeSeq: sequence },
    observedAt: snapshot.producedAt, matchId: f.matchId, competitionId: f.seasonId, contextRevision: f.contextRevision,
    mapId: f.mapOneId, mapName: "de_ancient", entryAId: f.entryAId, entryBId: f.entryBId,
    evidence: { identity: "degraded", telemetryFresh: true, contextFresh: true, source: "runtime-transition", lineupMismatchOnly: true },
    kind, payload: kind === "map_ended" ? { scoreA: 13, scoreB: 9, scoreCT: 13, scoreT: 9 }
      : kind === "series_ended" ? { scoreA: 2, scoreB: 0 } : {} };
}
async function source(f: Fixture) {
  return (await db.select().from(schema.matchLiveSessions).where(and(eq(schema.matchLiveSessions.matchId, f.matchId), isNull(schema.matchLiveSessions.closedAt))))[0]!;
}

describe("observed lineup display without official attribution", () => {
  it("claims explicitly, binds a display map, and leaves roster/results/settlement facts untouched", async () => {
    const { f, ids, roster, snapshot } = await observedFixture();
    const mapsBefore = await db.select().from(schema.matchMaps).where(eq(schema.matchMaps.matchId, f.matchId));
    const matchBefore = await db.query.matches.findFirst({ where: eq(schema.matches.id, f.matchId) });
    await db.insert(schema.betPrograms).values({ seasonId: f.seasonId, dirty: false });
    expect(await ingestMizarReliable(f.installationId, f.seasonId, event(f, snapshot), f.authorityRevision, ids)).toMatchObject({ outcome: "needs_attention" });
    expect(await source(f)).toMatchObject({ identityHealth: "healthy", lineupHealth: "review_required", autoCanonicalizationArmed: false, currentMapId: f.mapOneId, mapExecutionPhase: "gameplay" });
    const publicContext = await loadPublicMatchPhase(matchBefore!, mapsBefore);
    expect(publicContext.phase).toBe("gameplay");
    const projection = projectPublicLive(snapshot, f.authorityRevision, snapshot.producedAt, new Map(roster.filter(player => player.steam64).map(player => [player.steam64!, player.userId])));
    expect(parsePublicLiveProjection(projection, f.matchId)).not.toBeNull();
    expect(projection.players[0]!.canonicalPlayerId).toBeNull();
    expect(projection.players[5]!.canonicalPlayerId).toBeNull();
    expect(projection.players[1]!.canonicalPlayerId).not.toBeNull();
    const revalidated = event(f, snapshot, "map_started", 2);
    revalidated.evidence = { ...revalidated.evidence, identity: "matched", lineupMismatchOnly: false };
    await ingestMizarReliable(f.installationId, f.seasonId, revalidated, f.authorityRevision, f.steam64);
    expect(await source(f)).toMatchObject({ lineupHealth: "review_required", autoCanonicalizationArmed: false });
    for (const [kind, seq] of [["map_ended", 3], ["series_ended", 4]] as const) {
      const end = event(f, snapshot, kind, seq);
      end.evidence = { ...end.evidence, identity: "matched", lineupMismatchOnly: false };
      expect(await ingestMizarReliable(f.installationId, f.seasonId, end, f.authorityRevision, f.steam64)).toMatchObject({ outcome: "needs_attention" });
    }
    expect(await db.select().from(schema.matchMaps).where(eq(schema.matchMaps.matchId, f.matchId))).toEqual(mapsBefore);
    expect(await db.query.matches.findFirst({ where: eq(schema.matches.id, f.matchId) })).toEqual(matchBefore);
    expect(await loadEffectiveMatchRoster(db, [f.matchId])).toEqual(roster);
    expect(await db.query.betPrograms.findFirst({ where: eq(schema.betPrograms.seasonId, f.seasonId) })).toMatchObject({ dirty: false });
  });

  it("allows only confirmed observed-lineup live through the source and map fences", async () => {
    const { f, ids, snapshot } = await observedFixture();
    await ingestMizarReliable(f.installationId, f.seasonId, event(f, snapshot), f.authorityRevision, ids);
    for (const invalid of [
      { ...snapshot, capability: { ...snapshot.capability, lineupMismatchOnly: false } },
      { ...snapshot, capability: { ...snapshot.capability, identity: "mismatch" } },
      { ...snapshot, capability: { ...snapshot.capability, canonicalTeams: false } },
      { ...snapshot, capability: { ...snapshot.capability, telemetryFresh: false } },
      { ...snapshot, map: { ...snapshot.map, name: "de_mirage" } },
      { ...snapshot, map: { ...snapshot.map, mapId: f.mapTwoId } },
      { ...snapshot, matchId: randomUUID() },
      { ...snapshot, cursor: { ...snapshot.cursor, mapEpoch: 2 } },
      { ...snapshot, players: [...snapshot.players.slice(0, 9), snapshot.players[0]!] },
    ]) await expect(ingestMizarLive(f.installationId, f.seasonId, invalid, f.authorityRevision)).rejects.toBeInstanceOf(AppError);
    await expect(ingestMizarLive(f.installationBId, f.seasonId, snapshot, f.authorityRevision)).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
    const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const previousKey = process.env.SUPABASE_SECRET_KEY;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:1";
    process.env.SUPABASE_SECRET_KEY = "sb_secret_integration-test-service-key";
    try {
      // Provider delivery is verified separately against Local Supabase in CI.
      // This real-DB check must reach the transport rather than fail authorization.
      const outcome = await ingestMizarLive(f.installationId, f.seasonId, snapshot, f.authorityRevision).catch((error: unknown) => error);
      expect(outcome).toEqual({ accepted: false, reason: "broadcast_unavailable" });
    } finally {
      if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
      if (previousKey === undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = previousKey;
    }
  });



  it("locks a previously healthy claimed source when a lineup difference appears and survives later matched/generation events", async () => {
    const f = await seedFixture();
    const snapshot = parseLiveSnapshotV1(fixture.snapshot);
    snapshot.cursor = { ...snapshot.cursor, producerInstanceId: f.producerInstanceId, liveSessionId: f.liveSessionId, runtimeSeq: 1, programSourceGeneration: 0, mapEpoch: 1 };
    const ids = [...f.steam64]; ids[0] = "76561190000000001";
    const changed = { ...event(f, snapshot, "lineup_mismatch", 1), payload: { reason: "unexpected_human_steam64" } };
    await ingestMizarReliable(f.installationId, f.seasonId, changed, f.authorityRevision, ids);
    expect(await source(f)).toMatchObject({ lineupHealth: "review_required", autoCanonicalizationArmed: false });
    const generation = { ...event(f, snapshot, "source_generation_changed", 2), payload: { previousSourceGeneration: 0 } };
    generation.cursor.programSourceGeneration = 1;
    generation.evidence = { ...generation.evidence, identity: "matched", lineupMismatchOnly: false };
    await ingestMizarReliable(f.installationId, f.seasonId, generation, f.authorityRevision);
    const start = event(f, snapshot, "map_started", 3);
    start.cursor.programSourceGeneration = 1;
    start.evidence = { ...start.evidence, identity: "matched", lineupMismatchOnly: false };
    await ingestMizarReliable(f.installationId, f.seasonId, start, f.authorityRevision, f.steam64);
    expect(await source(f)).toMatchObject({ lineupHealth: "review_required", autoCanonicalizationArmed: false, mapExecutionPhase: "gameplay" });
    const end = event(f, snapshot, "map_ended", 4);
    end.cursor.programSourceGeneration = 1;
    end.evidence = { ...end.evidence, identity: "matched", lineupMismatchOnly: false };
    await ingestMizarReliable(f.installationId, f.seasonId, end, f.authorityRevision, f.steam64);
    expect(await db.query.matchMaps.findFirst({ where: eq(schema.matchMaps.id, f.mapOneId) })).toMatchObject({ startedAt: null, completedAt: null, scoreA: null, scoreB: null });
  });

  it("continues BO3 display only after an observed end and epoch change, without skipping or recording maps", async () => {
    const { f, ids, snapshot } = await observedFixture();
    await ingestMizarReliable(f.installationId, f.seasonId, event(f, snapshot), f.authorityRevision, ids);
    const next = { ...event(f, snapshot, "map_started", 2), mapId: f.mapTwoId, mapName: "de_mirage" };
    await ingestMizarReliable(f.installationId, f.seasonId, next, f.authorityRevision, ids);
    expect((await source(f)).currentMapId).toBe(f.mapOneId);
    // An invalid observation marks execution conflict, so a fresh fixture keeps
    // the positive progress journey independent of the refusal above.
    const second = await observedFixture();
    const g = second.f;
    await ingestMizarReliable(g.installationId, g.seasonId, event(g, second.snapshot), g.authorityRevision, second.ids);
    await ingestMizarReliable(g.installationId, g.seasonId, event(g, second.snapshot, "map_ended", 2), g.authorityRevision, second.ids);
    const epoch = { ...event(g, second.snapshot, "map_epoch_changed", 3), payload: { previousMapEpoch: 1, reason: "next map" } };
    epoch.cursor.mapEpoch = 2;
    await ingestMizarReliable(g.installationId, g.seasonId, epoch, g.authorityRevision);
    const start = { ...event(g, second.snapshot, "map_started", 4), mapId: g.mapTwoId, mapName: "de_mirage" };
    start.cursor.mapEpoch = 2;
    start.evidence = { ...start.evidence, identity: "matched", lineupMismatchOnly: false };
    await ingestMizarReliable(g.installationId, g.seasonId, start, g.authorityRevision, g.steam64);
    expect(await source(g)).toMatchObject({ currentMapId: g.mapTwoId, mapExecutionPhase: "gameplay", lineupHealth: "review_required", autoCanonicalizationArmed: false });
    const match = (await db.query.matches.findFirst({ where: eq(schema.matches.id, g.matchId) }))!;
    const maps = await db.select().from(schema.matchMaps).where(eq(schema.matchMaps.matchId, g.matchId));
    expect(maps.every(map => !map.startedAt && !map.completedAt && map.scoreA === null && map.scoreB === null)).toBe(true);
    expect(await loadPublicMatchPhase(match, maps)).toMatchObject({ phase: "gameplay", currentMapId: g.mapTwoId });
  });

  it("does not establish gameplay from a generic identity failure, wrong map or stale evidence", async () => {
    for (const override of [
      { evidence: { identity: "mismatch", telemetryFresh: true, contextFresh: true, source: "runtime-transition", lineupMismatchOnly: true } },
      { evidence: { identity: "degraded", telemetryFresh: true, contextFresh: true, source: "runtime-transition" } },
      { mapId: randomUUID(), mapName: "de_nuke" },
      { evidence: { identity: "degraded", telemetryFresh: false, contextFresh: true, source: "runtime-transition", lineupMismatchOnly: true } },
    ]) {
      const { f, ids, snapshot } = await observedFixture();
      await ingestMizarReliable(f.installationId, f.seasonId, { ...event(f, snapshot), ...override }, f.authorityRevision, ids);
      expect(await source(f)).toMatchObject({ autoCanonicalizationArmed: false, mapExecutionPhase: "waiting" });
    }
  });
});
