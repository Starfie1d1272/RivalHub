import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { LINEUP_REVIEW_REQUIRED } from "@/lib/mizar/lineup-display";
import {
  parseReliableEventV2,
  RELIABLE_EVENT_SCHEMA_VERSION,
  RELIABLE_EVENT_V2_SCHEMA_VERSION,
} from "@/lib/mizar/protocol";
import { projectOperatorSource } from "@/lib/admin/matches/source-state";

const mocks = vi.hoisted(() => ({
  tx: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
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

import { ingestMizarReliableV2 } from "@/lib/mizar/reliable-v2";
import { ingestMizarReliable } from "@/lib/mizar/reliable";

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

describe("Mizar reliable v2", () => {
  const installationId = randomUUID();
  const competitionId = randomUUID();
  const matchId = randomUUID();
  const entryAId = randomUUID();
  const entryBId = randomUUID();
  const mapId = randomUUID();
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
  });

  it("canonicalizes map_ended directly without a prior map_started", async () => {
    mocks.tx.select
      .mockReturnValueOnce(selectChain([baseSession()]))
      .mockReturnValueOnce(selectChain([]))
      .mockReturnValueOnce(
        selectChain([{ id: mapId, matchId, mapOrder: 1, mapName: "de_ancient", completedAt: null }]),
      );

    const res = await ingestMizarReliableV2(installationId, competitionId, baseEvent());
    expect(res).toEqual({ outcome: "canonicalized", duplicate: false });
    expect(mocks.recordCanonicalMapResultInTx).toHaveBeenCalledTimes(1);
    expect(mocks.recordCanonicalMapResultInTx).toHaveBeenCalledWith(
      mocks.tx,
      expect.objectContaining({
        matchId,
        mapOrder: 1,
        mapName: "de_ancient",
        scoreA: 13,
        scoreB: 9,
      }),
    );
  });

  it("canonicalizes with warning when all 10 players belong to the two teams (substitute/order diff)", async () => {
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
    const registeredRows = defaultSteam64.map((steam64, i) => ({
      entryId: i < 5 ? entryAId : entryBId,
      steam64,
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
      outcome: "canonicalized_with_warning",
      duplicate: false,
      warning: "lineup_mismatch",
    });
    expect(mocks.recordCanonicalMapResultInTx).toHaveBeenCalledTimes(1);
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({ lineupHealth: LINEUP_REVIEW_REQUIRED }),
    );
    expect(mocks.writeAuditInTx).toHaveBeenCalledWith(
      mocks.tx,
      expect.objectContaining({
        action: "mizar.reliable.accept",
        meta: expect.objectContaining({
          warning: "lineup_mismatch",
          lineupDifference: expect.objectContaining({
            missing: expect.arrayContaining([
              expect.objectContaining({ steam64: "76561198000000099" }),
            ]),
          }),
        }),
      }),
    );
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
      steam64,
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
    expect(mocks.writeAuditInTx).toHaveBeenCalledWith(
      mocks.tx,
      expect.objectContaining({
        action: "mizar.reliable.accept",
        meta: expect.objectContaining({
          warning: "lineup_mismatch",
          scoreA: 13,
          scoreB: 9,
          lineupDifference: expect.anything(),
        }),
      }),
    );
  });

  it("allows late map_ended submission within 24h of non-revoked session close", async () => {
    const closedAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
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

  it("validates ReliableEventV2 schema strictly", () => {
    expect(() => parseReliableEventV2(baseEvent())).not.toThrow();
    expect(() => parseReliableEventV2({ ...baseEvent(), extraField: true })).toThrow();
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
