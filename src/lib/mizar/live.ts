import "server-only";
import { createHmac } from "node:crypto";
import { and, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { matches, matchMaps, matchLiveSessions, seasons, competitionQualificationRuns } from "@/db/schema";
import { createServiceClient } from "@/lib/auth/supabase-server";
import { loadEffectiveMatchRoster } from "@/lib/match-rosters/effective";
import { logEvent } from "@/lib/observability/server";
import { AppError, ErrorCode } from "@/lib/errors";
import { assertInstallationInTx } from "./installation";
import { parseLiveSnapshotV1 } from "./protocol";
import { projectPublicLive } from "./live-projection";
import { admitLiveDelivery } from "./live-admission";
import { hasObservedLineup, hasCurrentLineup, isLineupMismatchOnly, LINEUP_REVIEW_REQUIRED } from "./lineup-display";
import { createLiveBroadcastFetch, liveBroadcastException } from "./live-broadcast";

// One producer cadence interval; requests delayed beyond it are disposable.
const LIVE_FRAME_BUDGET_MS = 500;

export const matchLiveTopic = (matchId: string) => `match-live:${matchId}`;

/** Read/validate/broadcast only. Share locks keep handover atomic with publication. */
export async function ingestMizarLive(installationId: string, competitionId: string, input: unknown, authorityRevision: number, receivedAt = performance.now()) {
  const snapshot = parseLiveSnapshotV1(input);
  if (snapshot.competitionId !== competitionId || snapshot.cursor.liveSessionId === null) throw new AppError(ErrorCode.FORBIDDEN, "制播数据不属于当前连接。");
  let cleanup: (() => Promise<unknown>) | undefined;
  try {
    return await db.transaction(async tx => {
      // No stale frame may sit in the shared pool and later become fresh again.
      if (performance.now() - receivedAt > LIVE_FRAME_BUDGET_MS) return { accepted: false, reason: "frame_expired" };
      await tx.execute(sql`SET LOCAL lock_timeout = '25ms'`);
      await tx.execute(sql`SET LOCAL statement_timeout = '1000ms'`);
      const gate = await tx.execute<{ acquired: boolean }>(sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${'mizar-live:' + snapshot.matchId}, 0)) AS acquired`);
      if (!gate.rows[0]?.acquired) return { accepted: false, reason: "contended" };
      await assertInstallationInTx(tx, installationId, competitionId);
      const [match] = await tx.select().from(matches).where(and(eq(matches.id, snapshot.matchId), eq(matches.seasonId, competitionId))).for("share");
      const [source] = await tx.select().from(matchLiveSessions).where(and(eq(matchLiveSessions.matchId, snapshot.matchId), isNull(matchLiveSessions.closedAt))).for("share");
      const observedLineup = source?.identityHealth === "healthy" && source.lineupHealth === LINEUP_REVIEW_REQUIRED
        && source.continuityHealth === "healthy" && !source.autoCanonicalizationArmed
        && source.mapExecutionPhase === "gameplay" && source.currentMapId === snapshot.map.mapId
        && source.manualTakeoverMapEpoch !== snapshot.cursor.mapEpoch && (hasObservedLineup(snapshot) || snapshot.capability.identity === "matched" && hasCurrentLineup(snapshot.players));
      if (isLineupMismatchOnly(snapshot.capability) && !observedLineup) throw new AppError(ErrorCode.FORBIDDEN, "名单差异仍需确认展示来源。");
      if (!match || match.status !== "in_progress" || match.format !== snapshot.format || !source || source.installationId !== installationId || source.authorityRevision !== authorityRevision || source.producerInstanceId !== snapshot.cursor.producerInstanceId || source.liveSessionId !== snapshot.cursor.liveSessionId || source.programSourceGeneration !== snapshot.cursor.programSourceGeneration || source.mapEpoch !== snapshot.cursor.mapEpoch || snapshot.cursor.runtimeSeq < source.lastReliableSeq || source.identityHealth !== "healthy" || (source.lineupHealth !== "healthy" && !observedLineup) || !snapshot.capability.telemetryFresh || !snapshot.capability.contextFresh || (snapshot.capability.identity !== "matched" && !observedLineup) || !snapshot.capability.lineupComplete || !snapshot.capability.canonicalTeams) {
        throw new AppError(ErrorCode.FORBIDDEN, "实时数据源或本场首发校验未通过。");
      }
      if (observedLineup) {
        const [map] = await tx.select({ id: matchMaps.id }).from(matchMaps).where(and(
          eq(matchMaps.id, source!.currentMapId!), eq(matchMaps.matchId, match.id),
          eq(matchMaps.mapName, snapshot.map.name ?? ""), eq(matchMaps.mapOrder, snapshot.series.currentMapOrder ?? -1),
          isNull(matchMaps.completedAt),
        ));
        if (!map) throw new AppError(ErrorCode.FORBIDDEN, "实时地图不匹配。");
      }
      if (![match.entryAId, match.entryBId].includes(snapshot.teams.ct.entryId ?? "") || ![match.entryAId, match.entryBId].includes(snapshot.teams.t.entryId ?? "") || snapshot.teams.ct.entryId === snapshot.teams.t.entryId) throw new AppError(ErrorCode.VALIDATION_FAILED, "实时队伍不匹配。");
      if (performance.now() - receivedAt > LIVE_FRAME_BUDGET_MS) return { accepted: false, reason: "frame_expired" };
      const identities = observedLineup
        ? new Map((await loadEffectiveMatchRoster(tx, [match.id])).filter(player => player.steam64 && player.isStarter).map(player => [player.steam64!, player.userId]))
        : undefined;
      if (performance.now() - receivedAt > LIVE_FRAME_BUDGET_MS) return { accepted: false, reason: "frame_expired" };
      const payload = projectPublicLive(snapshot, authorityRevision, new Date().toISOString(), identities);
      if (!admitLiveDelivery(snapshot, authorityRevision)) return { accepted: false, reason: "delivery_dropped" };
      const broadcast = createLiveBroadcastFetch();
      const client = createServiceClient({ fetch: broadcast.fetch });
      const channel = client.channel(matchLiveTopic(match.id), { config: { private: true } });
      cleanup = () => client.removeChannel(channel);
      const startedAt = performance.now();
      let stage = "auth";
      try {
        await client.realtime.setAuth();
        stage = "send";
        const result = await channel.httpSend("snapshot", payload, { timeout: 2000 });
        if (!result.success) throw new Error("broadcast_unavailable");
        return { accepted: true };
      } catch (error) {
        logEvent({ level: "warn", event: "mizar.live.broadcast_unavailable", scope: "match", operation: "broadcast", errorClass: "dependency", exception: broadcast.exception() ?? liveBroadcastException(error), retryable: false, durationMs: performance.now() - startedAt, safeContext: { provider: "supabase", stage, ...broadcast.evidence() } });
        return { accepted: false, reason: "broadcast_unavailable" };
      }
    });
  } catch (error) {
    // Lock/statement budgets drop this frame. No DB/HTTP replay, including
    // ambiguous connection failures (the shared DB retry owner is unchanged).
    const cause = error instanceof Error && error.cause ? error.cause : error;
    const code = cause && typeof cause === "object" && "code" in cause ? cause.code : undefined;
    if (code === "55P03" || code === "57014") return { accepted: false, reason: "contended" };
    throw error;
  } finally {
    // Channel never subscribes. Disposal cannot hold DB/authority locks; send did.
    await cleanup?.();
  }
}

/** Scope-limited five-minute JWT. No Auth user or producer credential is created. */
export async function issueLiveViewerToken(matchId: string, cachePartition: string | null = null) {
  const [match] = await db.select({ id: matches.id, seasonId: matches.seasonId, updatedAt: matches.updatedAt,
    contextRevision: matchLiveSessions.contextRevision, authorityRevision: matchLiveSessions.authorityRevision,
    generation: matchLiveSessions.programSourceGeneration, epoch: matchLiveSessions.mapEpoch,
    manualTakeoverEpoch: matchLiveSessions.manualTakeoverMapEpoch,
    mapId: matchLiveSessions.currentMapId, phase: matchLiveSessions.mapExecutionPhase,
    mapStartedAt: matchMaps.startedAt, mapCompletedAt: matchMaps.completedAt,
    identity: matchLiveSessions.identityHealth, lineup: matchLiveSessions.lineupHealth,
  }).from(matches).innerJoin(seasons, eq(seasons.id, matches.seasonId))
    .leftJoin(matchLiveSessions, and(eq(matchLiveSessions.matchId, matches.id), isNull(matchLiveSessions.closedAt)))
    .leftJoin(matchMaps, and(eq(matchMaps.id, matchLiveSessions.currentMapId), eq(matchMaps.matchId, matches.id))).where(and(
    eq(matches.id, matchId),
    eq(matches.status, "in_progress"),
    or(eq(seasons.status, "playing"), and(
      eq(seasons.status, "registration"),
      isNull(matches.testConfig),
      // The composite FK and qualification shape constraint own official scope.
      sql`EXISTS (SELECT 1 FROM ${competitionQualificationRuns} WHERE ${competitionQualificationRuns.id} = ${matches.qualificationRunId} AND ${competitionQualificationRuns.seasonId} = ${matches.seasonId} AND ${competitionQualificationRuns.startedAt} IS NOT NULL AND ${competitionQualificationRuns.completedAt} IS NULL)`,
    ), and(
      isNotNull(matches.testConfig),
      inArray(seasons.status, ["registration", "voting", "drafting"]),
    )),
  ));
  if (!match) throw new AppError(ErrorCode.NOT_FOUND, "比赛实时数据不可用。");
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) throw new AppError(ErrorCode.INTERNAL_ERROR, "实时连接暂时不可用。");
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ role: "authenticated", scope: "live-viewer", matchId, iat: now, exp: now + 300, iss: "rivalhub", aud: "authenticated" })}`;
  const cacheContext = cachePartition && match.contextRevision && match.mapId && match.phase === "gameplay"
    && match.mapStartedAt && !match.mapCompletedAt && match.manualTakeoverEpoch !== match.epoch
    && match.identity === "healthy" && match.lineup === "healthy" && match.authorityRevision !== null
    && match.generation !== null && match.epoch !== null
    ? { schemaVersion: "rivalhub.previous-live.v1" as const, seasonId: match.seasonId, matchId,
      revision: createHmac("sha256", secret).update(JSON.stringify([
        "previous-live:v1", cachePartition, match.seasonId, matchId, match.updatedAt,
        match.contextRevision, match.authorityRevision, match.generation, match.epoch, match.mapId,
      ])).digest("hex"),
      boundary: { authorityRevision: match.authorityRevision, generation: match.generation, epoch: match.epoch, mapId: match.mapId },
      checkedAt: Date.now(),
    } : null;
  return { token: `${unsigned}.${createHmac("sha256", secret).update(unsigned).digest("base64url")}`, topic: matchLiveTopic(matchId), expiresAt: (now + 300) * 1000, cacheContext };
}
