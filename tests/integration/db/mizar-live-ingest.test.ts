import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "../../../src/db/client";
import { testSteam64 } from "./harness/database";
import * as schema from "../../../src/db/schema";
import { AppError, ErrorCode } from "../../../src/lib/errors";
import { loadMizarMatchDocumentInTx } from "../../../src/lib/mizar/context";
import { ingestMizarLive } from "../../../src/lib/mizar/live";
import { ingestMizarReliable } from "../../../src/lib/mizar/reliable";
import { claimMizarSource, releaseMizarSource, takeOverCurrentMap } from "../../../src/lib/mizar/source";
import { RELIABLE_EVENT_SCHEMA_VERSION } from "../../../src/lib/mizar/protocol";

// The integration runner provisions a disposable database per worker (see
// scripts/db/integration-runner.ts), so committed fixtures need no teardown.
const NOW = new Date("2026-09-28T00:00:00.000Z");

interface Fixture {
  seasonId: string;
  entryAId: string;
  entryBId: string;
  matchId: string;
  mapOneId: string;
  mapTwoId: string;
  installationId: string;
  installationBId: string;
  sessionId: string;
  producerInstanceId: string;
  liveSessionId: string;
  contextRevision: string;
  authorityRevision: number;
  steam64: string[];
}

async function seedFixture(options: { matchStatus?: "scheduled" | "in_progress"; freezeEventRoster?: boolean } = {}): Promise<Fixture> {
  const seasonId = randomUUID();
  const entryAId = randomUUID();
  const entryBId = randomUUID();
  const matchId = randomUUID();
  const mapOneId = randomUUID();
  const mapTwoId = randomUUID();
  const revisionA = randomUUID();
  const revisionB = randomUUID();
  const eventRosterA = randomUUID();
  const eventRosterB = randomUUID();
  const rosterA = randomUUID();
  const rosterB = randomUUID();
  const pairingIntentA = randomUUID();
  const pairingIntentB = randomUUID();
  const installationId = randomUUID();
  const installationBId = randomUUID();
  const userIds = Array.from({ length: 10 }, () => randomUUID());
  const participantIds = Array.from({ length: 10 }, () => randomUUID());
  const eventMemberIds = Array.from({ length: 10 }, () => randomUUID());
  const steam64 = userIds.map((id) => testSteam64(id));
  const producerInstanceId = "producer-fixture";
  const liveSessionId = "live-fixture";
  const contextRevision = "context-fixture";
  const authorityRevision = 1;
  let session: { id: string }[] | undefined;

  await db.transaction(async (tx) => {
    await tx.insert(schema.users).values(userIds.map((id, index) => ({ id, email: `${id}@local.test`, steam64: steam64[index]! })));
    await tx.insert(schema.seasons).values({ id: seasonId, slug: seasonId, name: "Mizar live boundary", kind: "custom", status: "playing" });
    await tx.insert(schema.competitionEntries).values([
      { id: entryAId, competitionId: seasonId, source: "event_native", name: "Provider A", representativeUserId: userIds[0]!, registrationStatus: "approved", currentRosterRevisionId: revisionA, approvedRosterRevisionId: revisionA, reviewReason: "private-review-marker", perfectTeamId: "private-perfect-marker" },
      { id: entryBId, competitionId: seasonId, source: "event_native", name: "Provider B", representativeUserId: userIds[5]!, registrationStatus: "approved", currentRosterRevisionId: revisionB, approvedRosterRevisionId: revisionB },
    ]);
    await tx.insert(schema.competitionEntryRepresentativeChanges).values([
      { entryId: entryAId, fromUserId: null, toUserId: userIds[0]!, changedByActorId: "integration-test" },
      { entryId: entryBId, fromUserId: null, toUserId: userIds[5]!, changedByActorId: "integration-test" },
    ]);
    await tx.insert(schema.competitionEntryRosterRevisions).values([
      { id: revisionA, entryId: entryAId, revisionNumber: 1, status: "approved", createdBy: userIds[0]!, approvedAt: NOW },
      { id: revisionB, entryId: entryBId, revisionNumber: 1, status: "approved", createdBy: userIds[5]!, approvedAt: NOW },
    ]);
    await tx.insert(schema.competitionEntryParticipants).values(userIds.map((userId, index) => ({
      id: participantIds[index]!,
      entryId: index < 5 ? entryAId : entryBId,
      userId,
      status: "confirmed" as const,
      invitedByUserId: index < 5 ? userIds[0]! : userIds[5]!,
      confirmedAt: NOW,
    })));
    await tx.insert(schema.competitionEntryRosterMembers).values(userIds.map((userId, index) => ({
      id: randomUUID(),
      revisionId: index < 5 ? revisionA : revisionB,
      participantId: participantIds[index]!,
      userId,
      isPrimaryStarter: true,
    })));
    // Members must be written before the roster is frozen; the active chain has a
    // trigger that makes frozen event-roster members immutable.
    await tx.insert(schema.eventRosters).values([
      { id: eventRosterA, entryId: entryAId, sourceRosterRevisionId: revisionA, status: "confirmed", confirmedAt: NOW, confirmedBy: userIds[0]! },
      { id: eventRosterB, entryId: entryBId, sourceRosterRevisionId: revisionB, status: "confirmed", confirmedAt: NOW, confirmedBy: userIds[5]! },
    ]);
    await tx.insert(schema.eventRosterMembers).values(userIds.map((userId, index) => ({
      id: eventMemberIds[index]!,
      eventRosterId: index < 5 ? eventRosterA : eventRosterB,
      userId,
      participantId: participantIds[index]!,
      isPrimaryStarter: true,
    })));    if (options.freezeEventRoster) {
      await tx.update(schema.eventRosters).set({ status: "frozen", frozenAt: NOW, frozenBy: userIds[0]! }).where(inArray(schema.eventRosters.id, [eventRosterA, eventRosterB]));
    }
    await tx.insert(schema.matches).values({
      id: matchId,
      seasonId,
      entryAId,
      entryBId,
      stage: "fixture-stage",
      format: "bo3",
      status: options.matchStatus ?? "in_progress",
      scheduledAt: new Date("2026-09-28T01:00:00.000Z"),
    });
    await tx.insert(schema.matchMaps).values([
      { id: mapOneId, matchId, mapOrder: 1, mapName: "de_ancient" },
      { id: mapTwoId, matchId, mapOrder: 2, mapName: "de_mirage" },
    ]);
    await tx.insert(schema.matchVetoSessions).values({ matchId, startedAt: NOW, completedAt: NOW });
    await tx.insert(schema.matchRosters).values([
      { id: rosterA, matchId, entryId: entryAId, source: "admin_select", status: "submitted" },
      { id: rosterB, matchId, entryId: entryBId, source: "admin_select", status: "submitted" },
    ]);
    await tx.insert(schema.matchRosterPlayers).values(userIds.map((_, index) => ({
      rosterId: index < 5 ? rosterA : rosterB,
      eventRosterMemberId: eventMemberIds[index]!,
      isStarter: true,
    })));
    await tx.insert(schema.mizarPairingIntents).values([
      { id: pairingIntentA, pollTokenHash: randomUUID(), status: "authorized", competitionId: seasonId, authorizedByUserId: userIds[0]!, authorizedAt: NOW, expiresAt: new Date(NOW.getTime() + 600_000) },
      { id: pairingIntentB, pollTokenHash: randomUUID(), status: "authorized", competitionId: seasonId, authorizedByUserId: userIds[5]!, authorizedAt: NOW, expiresAt: new Date(NOW.getTime() + 600_000) },
    ]);
    await tx.insert(schema.mizarInstallations).values([
      { id: installationId, competitionId: seasonId, pairingIntentId: pairingIntentA, authorizedByUserId: userIds[0]!, credentialHash: randomUUID() },
      { id: installationBId, competitionId: seasonId, pairingIntentId: pairingIntentB, authorizedByUserId: userIds[5]!, credentialHash: randomUUID() },
    ]);
    session = await tx.insert(schema.matchLiveSessions).values({
      matchId,
      installationId,
      producerInstanceId,
      liveSessionId,
      contextRevision,
      authorityRevision,
      programSourceGeneration: 0,
      mapEpoch: 1,
      identityHealth: "healthy",
      lineupHealth: "healthy",
      continuityHealth: "healthy",
      autoCanonicalizationArmed: true,
      currentMapId: mapOneId,
      mapExecutionPhase: "gameplay",
    }).returning({ id: schema.matchLiveSessions.id });
  });
  return { seasonId, entryAId, entryBId, matchId, mapOneId, mapTwoId, installationId, installationBId, sessionId: session![0]!.id, producerInstanceId, liveSessionId, contextRevision, authorityRevision, steam64 };
}

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

describe("Mizar reliable event ingest ownership", () => {
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
    expect(source.continuityHealth).toBe("conflict");
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
    expect(source.currentMapId).toBeNull();
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
    await takeOverCurrentMap(fixture.matchId, fixture.entryAId);
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
