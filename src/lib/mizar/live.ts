import "server-only";
import { createHmac } from "node:crypto";
import { and, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { matches, matchMaps, matchLiveSessions, mizarInstallations, seasons, competitionQualificationRuns } from "@/db/schema";
import { createServiceClient } from "@/lib/auth/supabase-server";
import { effectiveMatchRosterQuery } from "@/lib/match-rosters/effective";
import { logEvent, recordLiveIngestOutcome, recordLiveIngestStage, type LiveIngestOutcome } from "@/lib/observability/server";
import { beginRuntimeResource } from "@/lib/observability/runtime-resources";
import { AppError, ErrorCode } from "@/lib/errors";
import { parseLiveSnapshotV1 } from "./protocol";
import { projectPublicLive } from "./live-projection";
import { admitLiveDelivery } from "./live-admission";
import { hasObservedLineup, hasCurrentLineup, isLineupMismatchOnly, LINEUP_REVIEW_REQUIRED } from "./lineup-display";
import { createLiveBroadcastFetch, liveBroadcastException } from "./live-broadcast";

// One producer cadence interval; requests delayed beyond it are disposable.
const LIVE_FRAME_BUDGET_MS = 500;

export const matchLiveTopic = (matchId: string) => `match-live:${matchId}`;

/** Read/validate/broadcast only. Share locks keep handover atomic with publication. */
export async function ingestMizarLive(credentialHash: string, input: unknown, authorityRevision: number, receivedAt = performance.now()) {
  const snapshot = parseLiveSnapshotV1(input);
  if (snapshot.cursor.liveSessionId === null) throw new AppError(ErrorCode.FORBIDDEN, "制播数据不属于当前连接。");
  const finishResource = beginRuntimeResource("mizar.live");
  let cleanup: (() => Promise<unknown>) | undefined;
  let outcome: LiveIngestOutcome = "error";
  try {
    const result = await db.transaction(async tx => {
      // No stale frame may sit in the shared pool and later become fresh again.
      if (performance.now() - receivedAt > LIVE_FRAME_BUDGET_MS) return { accepted: false, reason: "frame_expired" };
      const gate = await tx.execute<{ acquired: boolean }>(sql`SELECT
        set_config('lock_timeout', '25ms', true), set_config('statement_timeout', '1000ms', true),
        pg_try_advisory_xact_lock(hashtextextended(${'mizar-live:' + snapshot.matchId}, 0)) AS acquired`);
      if (!gate.rows[0]?.acquired) return { accepted: false, reason: "contended" };
      // Materialized dependencies preserve installation → match → source lock order in one round trip.
      const authority = await tx.execute<{
        installationId: string | null;
        match: { id: string; status: string; format: string; entryAId: string; entryBId: string } | null;
        source: { installationId: string; authorityRevision: number; producerInstanceId: string; liveSessionId: string;
          programSourceGeneration: number; mapEpoch: number; lastReliableSeq: number; identityHealth: string;
          lineupHealth: string; continuityHealth: string; autoCanonicalizationArmed: boolean;
          mapExecutionPhase: string; currentMapId: string | null; manualTakeoverMapEpoch: number | null } | null;
        mapMatches: boolean;
        identities: Record<string, string>;
      }>(sql`WITH installation AS MATERIALIZED (
        SELECT ${mizarInstallations.id} AS id, ${mizarInstallations.competitionId} AS "competitionId" FROM ${mizarInstallations}
        WHERE ${mizarInstallations.credentialHash}=${credentialHash}
          AND ${mizarInstallations.revokedAt} IS NULL FOR SHARE
      ), current_match AS MATERIALIZED (
        SELECT ${matches.id} AS id, ${matches.status} AS status, ${matches.format} AS format,
          ${matches.entryAId} AS "entryAId", ${matches.entryBId} AS "entryBId"
        FROM ${matches} WHERE ${matches.id}=${snapshot.matchId} AND ${matches.seasonId}=(SELECT "competitionId" FROM installation)
          AND ${matches.seasonId}=${snapshot.competitionId} FOR SHARE
      ), current_source AS MATERIALIZED (
        SELECT ${matchLiveSessions.installationId} AS "installationId", ${matchLiveSessions.authorityRevision} AS "authorityRevision",
          ${matchLiveSessions.producerInstanceId} AS "producerInstanceId", ${matchLiveSessions.liveSessionId} AS "liveSessionId",
          ${matchLiveSessions.programSourceGeneration} AS "programSourceGeneration", ${matchLiveSessions.mapEpoch} AS "mapEpoch",
          ${matchLiveSessions.lastReliableSeq} AS "lastReliableSeq", ${matchLiveSessions.identityHealth} AS "identityHealth",
          ${matchLiveSessions.lineupHealth} AS "lineupHealth", ${matchLiveSessions.continuityHealth} AS "continuityHealth",
          ${matchLiveSessions.autoCanonicalizationArmed} AS "autoCanonicalizationArmed", ${matchLiveSessions.mapExecutionPhase} AS "mapExecutionPhase",
          ${matchLiveSessions.currentMapId} AS "currentMapId", ${matchLiveSessions.manualTakeoverMapEpoch} AS "manualTakeoverMapEpoch"
        FROM ${matchLiveSessions} WHERE ${matchLiveSessions.matchId}=(SELECT id FROM current_match)
          AND ${matchLiveSessions.closedAt} IS NULL FOR SHARE
      ), roster("matchId", "entryId", "rosterId", "eventRosterMemberId", "userId", "steam64", "displayName", "personaName", "perfectName", "isStarter") AS MATERIALIZED (
        ${effectiveMatchRosterQuery(tx, [snapshot.matchId])}
      ) SELECT (SELECT id FROM installation) AS "installationId",
        (SELECT row_to_json(current_match) FROM current_match) AS match,
        (SELECT row_to_json(current_source) FROM current_source) AS source,
        EXISTS (SELECT 1 FROM ${matchMaps} WHERE ${matchMaps.id}=(SELECT "currentMapId" FROM current_source)
          AND ${matchMaps.matchId}=${snapshot.matchId} AND ${matchMaps.mapName}=${snapshot.map.name ?? ""}
          AND ${matchMaps.mapOrder}=${snapshot.series.currentMapOrder ?? -1} AND ${matchMaps.completedAt} IS NULL) AS "mapMatches",
        CASE WHEN (SELECT "lineupHealth" FROM current_source)=${LINEUP_REVIEW_REQUIRED}
          THEN COALESCE((SELECT jsonb_object_agg("steam64", "userId") FROM roster WHERE "steam64" IS NOT NULL), '{}'::jsonb)
          ELSE '{}'::jsonb END AS identities`);
      const { installationId, match, source, mapMatches, identities: identityRows } = authority.rows[0]!;
      if (!installationId) throw new AppError(ErrorCode.FORBIDDEN, "制播设备连接已撤销。");
      const observedLineup = source?.identityHealth === "healthy" && source.lineupHealth === LINEUP_REVIEW_REQUIRED
        && source.continuityHealth === "healthy" && !source.autoCanonicalizationArmed
        && source.mapExecutionPhase === "gameplay" && source.currentMapId === snapshot.map.mapId
        && source.manualTakeoverMapEpoch !== snapshot.cursor.mapEpoch && (hasObservedLineup(snapshot) || snapshot.capability.identity === "matched" && hasCurrentLineup(snapshot.players));
      if (isLineupMismatchOnly(snapshot.capability) && !observedLineup) throw new AppError(ErrorCode.FORBIDDEN, "名单差异仍需确认展示来源。");
      if (!match || match.status !== "in_progress" || match.format !== snapshot.format || !source || source.installationId !== installationId || source.authorityRevision !== authorityRevision || source.producerInstanceId !== snapshot.cursor.producerInstanceId || source.liveSessionId !== snapshot.cursor.liveSessionId || source.programSourceGeneration !== snapshot.cursor.programSourceGeneration || source.mapEpoch !== snapshot.cursor.mapEpoch || snapshot.cursor.runtimeSeq < source.lastReliableSeq || source.identityHealth !== "healthy" || (source.lineupHealth !== "healthy" && !observedLineup) || !snapshot.capability.telemetryFresh || !snapshot.capability.contextFresh || (snapshot.capability.identity !== "matched" && !observedLineup) || !snapshot.capability.lineupComplete || !snapshot.capability.canonicalTeams) {
        throw new AppError(ErrorCode.FORBIDDEN, "实时数据源或本场首发校验未通过。");
      }
      if (observedLineup && !mapMatches) throw new AppError(ErrorCode.FORBIDDEN, "实时地图不匹配。");
      if (![match.entryAId, match.entryBId].includes(snapshot.teams.ct.entryId ?? "") || ![match.entryAId, match.entryBId].includes(snapshot.teams.t.entryId ?? "") || snapshot.teams.ct.entryId === snapshot.teams.t.entryId) throw new AppError(ErrorCode.VALIDATION_FAILED, "实时队伍不匹配。");
      recordLiveIngestStage("authorized", performance.now() - receivedAt);
      if (performance.now() - receivedAt > LIVE_FRAME_BUDGET_MS) return { accepted: false, reason: "frame_expired" };
      const identities = observedLineup
        ? new Map(Object.entries(identityRows))
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
        recordLiveIngestStage("send_success", performance.now() - receivedAt);
        return { accepted: true };
      } catch (error) {
        if (stage === "send" && ["timeout", "transport", "unknown"].includes(broadcast.evidence().reason)) {
          // Abort/transport failure does not prove that the provider did not accept it.
          recordLiveIngestStage("unknown_send", performance.now() - receivedAt);
        }
        logEvent({ level: "warn", event: "mizar.live.broadcast_unavailable", scope: "match", operation: "broadcast", errorClass: "dependency", exception: broadcast.exception() ?? liveBroadcastException(error), retryable: false, durationMs: performance.now() - startedAt, safeContext: { provider: "supabase", stage, ...broadcast.evidence() } });
        return { accepted: false, reason: "broadcast_unavailable" };
      }
    });
    outcome = result.accepted ? "accepted" : result.reason as LiveIngestOutcome;
    if (outcome === "frame_expired") recordLiveIngestStage("expired", performance.now() - receivedAt);
    if (outcome === "contended") recordLiveIngestStage("contended", performance.now() - receivedAt);
    return result;
  } catch (error) {
    // Lock/statement budgets drop this frame. No DB/HTTP replay, including
    // ambiguous connection failures (the shared DB retry owner is unchanged).
    const cause = error instanceof Error && error.cause ? error.cause : error;
    const code = cause && typeof cause === "object" && "code" in cause ? cause.code : undefined;
    if (code === "55P03" || code === "57014") { outcome = "contended"; recordLiveIngestStage("contended", performance.now() - receivedAt); return { accepted: false, reason: "contended" }; }
    if (error instanceof AppError) outcome = "rejected";
    throw error;
  } finally {
    // Channel never subscribes. Disposal cannot hold DB/authority locks; send did.
    try { await cleanup?.(); } finally {
      try { recordLiveIngestOutcome(outcome, performance.now() - receivedAt); } finally { finishResource(); }
    }
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
  const keyId = process.env.SUPABASE_JWT_KID;
  const unsigned = `${encode({ alg: "HS256", typ: "JWT", ...(keyId ? { kid: keyId } : {}) })}.${encode({ role: "authenticated", scope: "live-viewer", matchId, iat: now, exp: now + 300, iss: "rivalhub", aud: "authenticated" })}`;
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
