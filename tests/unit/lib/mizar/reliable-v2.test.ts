import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { LINEUP_REVIEW_REQUIRED } from "@/lib/mizar/lineup-display";
import { RELIABLE_EVENT_SCHEMA_VERSION } from "@/lib/mizar/protocol";
import { parseReliableEventV2, RELIABLE_EVENT_V2_SCHEMA_VERSION } from "@/lib/mizar/protocol-v2";
import { projectOperatorSource } from "@/lib/admin/matches/source-state";

const mocks = vi.hoisted(() => ({
  tx: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    execute: vi.fn(),
    query: {
      matchVetoSessions: { findFirst: vi.fn() },
    },
  },
  assertInstallationInTx: vi.fn(),
  lockMatchInTx: vi.fn(),
  applyMatchStatusTransitionInTx: vi.fn(),
  startCanonicalMapInTx: vi.fn(),
  recordCanonicalMapResultInTx: vi.fn(),
  loadEffectiveMatchRoster: vi.fn(),
  validateObservedLineupInTx: vi.fn(),
  writeAuditInTx: vi.fn(),
  touchMizarInstallation: vi.fn(),
  sendLiveBroadcast: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: {
    transaction: async <T>(fn: (tx: typeof mocks.tx) => Promise<T>) => fn(mocks.tx),
  },
}));
vi.mock("@/lib/mizar/installation", () => ({
  assertInstallationInTx: mocks.assertInstallationInTx,
  hashCredential: (v: string) => "hash:" + v.length + ":" + v.slice(0, 16),
}));
vi.mock("@/lib/mizar/heartbeat", () => ({
  touchMizarInstallation: mocks.touchMizarInstallation,
}));
vi.mock("@/lib/matches/locking", () => ({
  lockCompetitionMatchInTx: mocks.lockMatchInTx,
}));
vi.mock("@/lib/matches/lifecycle", () => ({
  applyMatchStatusTransitionInTx: mocks.applyMatchStatusTransitionInTx,
}));
vi.mock("@/lib/matches/map-start", () => ({
  startCanonicalMapInTx: mocks.startCanonicalMapInTx,
}));
vi.mock("@/lib/matches/results", () => ({
  recordCanonicalMapResultInTx: mocks.recordCanonicalMapResultInTx,
}));
vi.mock("@/lib/match-rosters/effective", () => ({
  loadEffectiveMatchRoster: mocks.loadEffectiveMatchRoster,
}));
vi.mock("@/lib/mizar/source", () => ({
  validateObservedLineupInTx: mocks.validateObservedLineupInTx,
}));
vi.mock("@/lib/audit/write", () => ({
  writeAuditInTx: mocks.writeAuditInTx,
}));
vi.mock("@/lib/observability/runtime-resources", () => ({
  beginRuntimeResource: () => () => {},
}));
vi.mock("@/lib/mizar/live-broadcast", () => ({
  createLiveBroadcastFetch: () => ({ fetch: vi.fn(), evidence: () => ({ reason: "ok" }), exception: () => null }),
  prepareLiveBroadcast: () => ({ url: "http://localhost", key: "test" }),
  sendLiveBroadcast: mocks.sendLiveBroadcast,
  liveBroadcastException: (e: unknown) => e,
}));
vi.mock("@/lib/mizar/live-admission", () => ({
  admitLiveDelivery: () => true,
}));
vi.mock("@/lib/observability/server", () => ({
  logEvent: vi.fn(),
  recordLiveIngestOutcome: vi.fn(),
  recordLiveIngestStage: vi.fn(),
}));

import { ingestMizarReliableV2 } from "@/lib/mizar/reliable-v2";
import { ingestMizarReliable } from "@/lib/mizar/reliable";
import { ingestMizarLive } from "@/lib/mizar/live";

function selectChain(rows: unknown[]) {
  const chain = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    for: vi.fn(),
    then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(resolve(rows)),
  };
  chain.from.mockReturnValue(chain);
  chain.innerJoin.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  chain.for.mockReturnValue(chain);
  return chain;
}

describe("Mizar reliable v2 & decoupled LIVE", () => {
  const installationId = randomUUID();
  const competitionId = randomUUID();
  const matchId = randomUUID();
  const entryAId = randomUUID();
  const entryBId = randomUUID();
  const mapId = randomUUID();
  const mapTwoId = randomUUID();
  const sessionId = randomUUID();
  const defaultSteam64 = Array.from({ length: 10 }, (_, i) => "7656119800000000" + i);

  const baseEvent = (overrides: Record<string, unknown> = {}) => ({
    schemaVersion: RELIABLE_EVENT_V2_SCHEMA_VERSION,
    idempotencyKey: "key-" + randomUUID(),
    kind: "map_ended",
    observedAt: "2026-11-28T10:00:00Z",
    matchId,
    competitionId,
    entryAId,
    entryBId,
    mapId,
    mapName: "de_ancient",
    session: {
      producerInstanceId: "prod-1",
      liveSessionId: "live-1",
      authorityRevision: 1,
    },
    payload: {
      scoreA: 13,
      scoreB: 9,
      scoreCT: 13,
      scoreT: 9,
      lineupSteam64: defaultSteam64,
    },
    ...overrides,
  });

  const baseSession = (overrides: Record<string, unknown> = {}) => ({
    id: sessionId,
    matchId,
    installationId,
    producerInstanceId: "prod-1",
    liveSessionId: "live-1",
    contextRevision: "rev-1",
    authorityRevision: 1,
    programSourceGeneration: 0,
    mapEpoch: 1,
    lastReliableSeq: 0,
    closedAt: null,
    closeReason: null,
    identityHealth: "healthy",
    lineupHealth: "healthy",
    continuityHealth: "healthy",
    autoCanonicalizationArmed: false,
    manualTakeoverMapEpoch: null,
    currentMapId: null,
    mapExecutionPhase: "waiting",
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lockMatchInTx.mockResolvedValue({
      id: matchId,
      seasonId: competitionId,
      entryAId,
      entryBId,
      status: "in_progress",
    });
    mocks.tx.query.matchVetoSessions.findFirst.mockResolvedValue({
      completedAt: new Date("2026-11-28T09:00:00Z"),
    });
    mocks.tx.update.mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    });
    mocks.tx.insert.mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    });
    mocks.loadEffectiveMatchRoster.mockResolvedValue([]);
    mocks.validateObservedLineupInTx.mockResolvedValue(true);
    mocks.sendLiveBroadcast.mockResolvedValue(undefined);
  });

  it("accepts a LIVE frame immediately for a newly claimed session with unknown health", async () => {
    mocks.tx.execute
      .mockResolvedValueOnce({ rows: [{ acquired: true }] })
      .mockResolvedValueOnce({
        rows: [
          {
            installationId,
            match: { id: matchId, status: "in_progress", format: "bo3", entryAId, entryBId },
            source: {
              installationId,
              authorityRevision: 1,
              producerInstanceId: "prod-1",
              liveSessionId: "live-1",
            },
            identities: {},
          },
        ],
      });

    const snapshot = {
      schemaVersion: "mizar.live-snapshot.v1",
      cursor: {
        producerInstanceId: "prod-1",
        liveSessionId: "live-1",
        runtimeSeq: 1,
        programSourceGeneration: 0,
        programReceiveSequence: 1,
        mapEpoch: 1,
      },
      producedAt: "2026-11-28T10:00:00Z",
      matchId,
      competitionId,
      format: "bo3",
      series: { scoreA: 0, scoreB: 0, currentMapOrder: 1 },
      roundHistory: null,
      map: { mapId: null, name: "de_ancient", phase: "live", roundNumber: 1, scoreCT: 4, scoreT: 2 },
      roundPhase: "live",
      clock: null,
      teams: { ct: { entryId: entryAId, name: "A" }, t: { entryId: entryBId, name: "B" } },
      players: [],
      observedPlayerSourceId: null,
      bomb: null,
      radar: null,
      capability: {
        telemetryFresh: true,
        contextFresh: true,
        identity: "matched",
        lineupComplete: true,
        radarCurrent: false,
        canonicalTeams: true,
      },
    };

    const res = await ingestMizarLive("cred-hash", snapshot, 1);
    expect(res).toEqual({ accepted: true });
    expect(mocks.sendLiveBroadcast).toHaveBeenCalledTimes(1);
  });

  it("canonicalizes Map 2 even after Map 1 was manually taken over", async () => {
    mocks.tx.select
      .mockReturnValueOnce(
        selectChain([
          baseSession({
            manualTakeoverMapEpoch: 1,
            mapEpoch: 1,
            currentMapId: mapId,
          }),
        ]),
      )
      .mockReturnValueOnce(selectChain([]))
      .mockReturnValueOnce(
        selectChain([
          { id: mapId, matchId, mapOrder: 1, mapName: "de_ancient", completedAt: new Date() },
          { id: mapTwoId, matchId, mapOrder: 2, mapName: "de_mirage", completedAt: null },
        ]),
      );

    const res = await ingestMizarReliableV2(
      installationId,
      competitionId,
      baseEvent({ mapId: mapTwoId, mapName: "de_mirage" }),
    );
    expect(res).toEqual({ outcome: "canonicalized", duplicate: false });
    expect(mocks.recordCanonicalMapResultInTx).toHaveBeenCalledWith(
      mocks.tx,
      expect.objectContaining({ mapOrder: 2, mapName: "de_mirage" }),
    );
  });

  it("canonicalizes substitute match and writes all 10 provisionalPlayers including substitutes", async () => {
    mocks.validateObservedLineupInTx.mockResolvedValue(false);
    const subSteam = "76561198000000099";
    const lineup = [...defaultSteam64.slice(0, 9), subSteam];
    mocks.loadEffectiveMatchRoster.mockResolvedValue([
      {
        userId: randomUUID(),
        steam64: defaultSteam64[9]!,
        displayName: "MissingStarter",
        personaName: null,
        perfectName: null,
        isStarter: true,
      },
    ]);
    const registeredRows = lineup.map((steam64, i) => ({
      entryId: i < 5 ? entryAId : entryBId,
      userId: randomUUID(),
      steam64,
      displayName: i === 9 ? "SubPlayer" : "Player" + i,
      perfectName: null,
    }));
    const setMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    mocks.tx.update.mockReturnValue({ set: setMock });
    mocks.tx.select
      .mockReturnValueOnce(selectChain([baseSession()]))
      .mockReturnValueOnce(selectChain([]))
      .mockReturnValueOnce(
        selectChain([{ id: mapId, matchId, mapOrder: 1, mapName: "de_ancient", completedAt: null }]),
      )
      .mockReturnValueOnce(selectChain(registeredRows));

    const playersPayload = lineup.map((sourcePlayerId, i) => ({
      sourcePlayerId,
      canonicalPlayerId: null,
      kills: 10 + i,
      assists: 2,
      deaths: 8,
    }));

    const res = await ingestMizarReliableV2(
      installationId,
      competitionId,
      baseEvent({
        payload: {
          scoreA: 13,
          scoreB: 9,
          scoreCT: 13,
          scoreT: 9,
          lineupSteam64: lineup,
          players: playersPayload,
        },
      }),
    );

    expect(res).toEqual({
      outcome: "canonicalized_with_warning",
      duplicate: false,
      warning: "lineup_mismatch",
    });
    expect(mocks.recordCanonicalMapResultInTx).toHaveBeenCalledTimes(1);
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({
        provisionalPlayers: expect.arrayContaining([
          expect.objectContaining({ name: "SubPlayer", kills: 19 }),
        ]),
      }),
    );
    const provisionalCall = setMock.mock.calls.find(
      (call) => Array.isArray((call[0] as { provisionalPlayers?: unknown }).provisionalPlayers),
    );
    expect((provisionalCall?.[0] as { provisionalPlayers: unknown[] }).provisionalPlayers).toHaveLength(10);
  });

  it("preserves LINEUP_REVIEW_REQUIRED from Map 1 when Map 2 finishes normally, and late Map 1 end does not overwrite gameplay phase", async () => {
    const setMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    mocks.tx.update.mockReturnValue({ set: setMock });
    mocks.tx.select
      .mockReturnValueOnce(
        selectChain([
          baseSession({
            lineupHealth: LINEUP_REVIEW_REQUIRED,
            currentMapId: mapTwoId,
            mapExecutionPhase: "gameplay",
          }),
        ]),
      )
      .mockReturnValueOnce(selectChain([]))
      .mockReturnValueOnce(
        selectChain([
          { id: mapId, matchId, mapOrder: 1, mapName: "de_ancient", completedAt: null },
          { id: mapTwoId, matchId, mapOrder: 2, mapName: "de_mirage", completedAt: null },
        ]),
      );

    const res = await ingestMizarReliableV2(installationId, competitionId, baseEvent({ mapId }));
    expect(res).toEqual({ outcome: "canonicalized", duplicate: false });
    const sessionUpdate = setMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sessionUpdate.lineupHealth).toBeUndefined();
    expect(sessionUpdate.mapExecutionPhase).toBeUndefined();
  });

  it("does not canonicalize and returns needs_attention when a stranger Steam64 or < 10 players is observed", async () => {
    mocks.validateObservedLineupInTx.mockResolvedValue(false);
    mocks.loadEffectiveMatchRoster.mockResolvedValue([
      {
        userId: randomUUID(),
        steam64: "76561198000000099",
        displayName: "StarterOne",
        personaName: null,
        perfectName: null,
        isStarter: true,
      },
    ]);
    const registeredRows = defaultSteam64.slice(1).map((steam64, i) => ({
      entryId: i < 4 ? entryAId : entryBId,
      userId: randomUUID(),
      steam64,
      displayName: "Player" + i,
      perfectName: null,
    }));
    const setMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    mocks.tx.update.mockReturnValue({ set: setMock });
    mocks.tx.select
      .mockReturnValueOnce(selectChain([baseSession()]))
      .mockReturnValueOnce(selectChain([]))
      .mockReturnValueOnce(
        selectChain([{ id: mapId, matchId, mapOrder: 1, mapName: "de_ancient", completedAt: null }]),
      )
      .mockReturnValueOnce(selectChain(registeredRows));

    const res = await ingestMizarReliableV2(installationId, competitionId, baseEvent());
    expect(res).toEqual({
      outcome: "needs_attention",
      duplicate: false,
      warning: "lineup_mismatch",
    });
    expect(mocks.recordCanonicalMapResultInTx).not.toHaveBeenCalled();
    expect(setMock).toHaveBeenCalledWith(expect.objectContaining({ lineupHealth: "conflict" }));
  });

  it("returns map_not_found when mapId and mapName disagree", async () => {
    mocks.tx.select
      .mockReturnValueOnce(selectChain([baseSession()]))
      .mockReturnValueOnce(selectChain([]))
      .mockReturnValueOnce(
        selectChain([{ id: mapId, matchId, mapOrder: 1, mapName: "de_ancient", completedAt: null }]),
      );

    const res = await ingestMizarReliableV2(
      installationId,
      competitionId,
      baseEvent({ mapId, mapName: "de_mirage" }),
    );
    expect(res).toEqual({
      outcome: "needs_attention",
      duplicate: false,
      warning: "map_not_found",
    });
    expect(mocks.recordCanonicalMapResultInTx).not.toHaveBeenCalled();
  });

  it("clears manualTakeoverMapEpoch on map_started for a new map and canonicalizes its map_ended", async () => {
    const setMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    mocks.tx.update.mockReturnValue({ set: setMock });
    mocks.tx.select
      .mockReturnValueOnce(
        selectChain([
          baseSession({
            manualTakeoverMapEpoch: 1,
            mapEpoch: 1,
            currentMapId: mapId,
          }),
        ]),
      )
      .mockReturnValueOnce(selectChain([]))
      .mockReturnValueOnce(
        selectChain([
          { id: mapId, matchId, mapOrder: 1, mapName: "de_ancient", completedAt: new Date() },
          { id: mapTwoId, matchId, mapOrder: 2, mapName: "de_mirage", completedAt: null },
        ]),
      );

    const startRes = await ingestMizarReliableV2(
      installationId,
      competitionId,
      baseEvent({
        kind: "map_started",
        mapId: mapTwoId,
        mapName: "de_mirage",
        payload: {},
      }),
    );
    expect(startRes).toEqual({ outcome: "accepted", duplicate: false });
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({
        currentMapId: mapTwoId,
        manualTakeoverMapEpoch: null,
        mapExecutionPhase: "gameplay",
      }),
    );

    mocks.tx.select
      .mockReturnValueOnce(
        selectChain([
          baseSession({
            manualTakeoverMapEpoch: null,
            mapEpoch: 1,
            currentMapId: mapTwoId,
          }),
        ]),
      )
      .mockReturnValueOnce(selectChain([]))
      .mockReturnValueOnce(
        selectChain([
          { id: mapId, matchId, mapOrder: 1, mapName: "de_ancient", completedAt: new Date() },
          { id: mapTwoId, matchId, mapOrder: 2, mapName: "de_mirage", completedAt: null },
        ]),
      );

    const endRes = await ingestMizarReliableV2(
      installationId,
      competitionId,
      baseEvent({ mapId: mapTwoId, mapName: "de_mirage" }),
    );
    expect(endRes).toEqual({ outcome: "canonicalized", duplicate: false });
    expect(mocks.recordCanonicalMapResultInTx).toHaveBeenCalledTimes(1);
  });

  it("allows late map_ended submission after 24h and within 7 days of non-revoked session close", async () => {
    const closedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    mocks.tx.select
      .mockReturnValueOnce(selectChain([baseSession({ closedAt, closeReason: "released" })]))
      .mockReturnValueOnce(selectChain([]))
      .mockReturnValueOnce(selectChain([]))
      .mockReturnValueOnce(
        selectChain([{ id: mapId, matchId, mapOrder: 1, mapName: "de_ancient", completedAt: null }]),
      );

    const res = await ingestMizarReliableV2(installationId, competitionId, baseEvent());
    expect(res).toEqual({ outcome: "canonicalized", duplicate: false });
    expect(mocks.recordCanonicalMapResultInTx).toHaveBeenCalledTimes(1);
  });

  it("does not overwrite already completed map when scores conflict", async () => {
    mocks.tx.select
      .mockReturnValueOnce(selectChain([baseSession()]))
      .mockReturnValueOnce(selectChain([]))
      .mockReturnValueOnce(
        selectChain([
          {
            id: mapId,
            matchId,
            mapOrder: 1,
            mapName: "de_ancient",
            scoreA: 13,
            scoreB: 7,
            completedAt: new Date(),
          },
        ]),
      );

    const res = await ingestMizarReliableV2(installationId, competitionId, baseEvent());
    expect(res).toEqual({
      outcome: "needs_attention",
      duplicate: false,
      warning: "result_conflict",
    });
    expect(mocks.recordCanonicalMapResultInTx).not.toHaveBeenCalled();
  });

  it("returns 200 observed no-op for legacy v1 boundary events", async () => {
    mocks.tx.select
      .mockReturnValueOnce(selectChain([baseSession({ autoCanonicalizationArmed: true })]))
      .mockReturnValueOnce(selectChain([]));

    const v1Boundary = {
      schemaVersion: RELIABLE_EVENT_SCHEMA_VERSION,
      idempotencyKey: "v1-" + randomUUID(),
      cursor: {
        producerInstanceId: "prod-1",
        liveSessionId: "live-1",
        runtimeSeq: 1,
        programSourceGeneration: 1,
        programReceiveSequence: 1,
        mapEpoch: 2,
      },
      observedAt: "2026-11-28T10:00:00Z",
      matchId,
      competitionId,
      contextRevision: "stale-rev",
      mapId,
      mapName: "de_ancient",
      entryAId,
      entryBId,
      evidence: {
        identity: "matched",
        telemetryFresh: true,
        contextFresh: true,
        source: "runtime-continuity",
      },
      kind: "map_epoch_changed",
      payload: { previousMapEpoch: 1, reason: "next" },
    };

    const res = await ingestMizarReliable(installationId, competitionId, v1Boundary, 1);
    expect(res).toEqual({ outcome: "observed", duplicate: false });
    expect(mocks.tx.update).not.toHaveBeenCalled();
  });

  it("validates ReliableEventV2 schema strictly and rejects series_ended", () => {
    expect(() => parseReliableEventV2(baseEvent())).not.toThrow();
    expect(() => parseReliableEventV2({ ...baseEvent(), extraField: true })).toThrow();
    expect(() =>
      parseReliableEventV2(baseEvent({ kind: "series_ended", payload: { scoreA: 2, scoreB: 0 } })),
    ).toThrow();
  });

  it("treats LINEUP_REVIEW_REQUIRED with completed maps as non-blocking warning in source-state", () => {
    const projected = projectOperatorSource({
      currentMapId: mapId,
      mapEpoch: 1,
      manualTakeoverMapEpoch: null,
      identityHealth: "healthy",
      lineupHealth: LINEUP_REVIEW_REQUIRED,
      continuityHealth: "healthy",
      autoCanonicalizationArmed: false,
      hasCompletedMaps: true,
    });
    expect(projected.lineupReviewWarning).toBe(true);
    expect(projected.reviewReasons).toEqual([]);
    expect(projected.sourceHealth).toBe("healthy");
  });
});
