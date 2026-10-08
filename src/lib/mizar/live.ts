import "server-only";
import { createHmac } from "node:crypto";
import { and, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { matches, matchLiveSessions, seasons } from "@/db/schema";
import { createServiceClient } from "@/lib/auth/supabase-server";
import { logEvent } from "@/lib/observability/server";
import { AppError, ErrorCode } from "@/lib/errors";
import { assertInstallationInTx } from "./installation";
import { parseLiveSnapshotV1 } from "./protocol";
import { projectPublicLive } from "./live-projection";
import { admitLiveDelivery } from "./live-admission";
import { liveBroadcastFetch } from "./live-broadcast";

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
      if (performance.now() - receivedAt > LIVE_FRAME_BUDGET_MS) return { accepted: false };
      await tx.execute(sql`SET LOCAL lock_timeout = '25ms'`);
      await tx.execute(sql`SET LOCAL statement_timeout = '1000ms'`);
      const gate = await tx.execute<{ acquired: boolean }>(sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${'mizar-live:' + snapshot.matchId}, 0)) AS acquired`);
      if (!gate.rows[0]?.acquired) return { accepted: false };
      await assertInstallationInTx(tx, installationId, competitionId);
      const [match] = await tx.select().from(matches).where(and(eq(matches.id, snapshot.matchId), eq(matches.seasonId, competitionId))).for("share");
      const [source] = await tx.select().from(matchLiveSessions).where(and(eq(matchLiveSessions.matchId, snapshot.matchId), isNull(matchLiveSessions.closedAt))).for("share");
      if (!match || match.status !== "in_progress" || match.format !== snapshot.format || !source || source.installationId !== installationId || source.authorityRevision !== authorityRevision || source.producerInstanceId !== snapshot.cursor.producerInstanceId || source.liveSessionId !== snapshot.cursor.liveSessionId || source.programSourceGeneration !== snapshot.cursor.programSourceGeneration || source.mapEpoch !== snapshot.cursor.mapEpoch || snapshot.cursor.runtimeSeq < source.lastReliableSeq || source.identityHealth !== "healthy" || source.lineupHealth !== "healthy" || !snapshot.capability.telemetryFresh || !snapshot.capability.contextFresh || snapshot.capability.identity !== "matched" || !snapshot.capability.lineupComplete || !snapshot.capability.canonicalTeams) {
        throw new AppError(ErrorCode.FORBIDDEN, "实时数据源或本场首发校验未通过。");
      }
      if (![match.entryAId, match.entryBId].includes(snapshot.teams.ct.entryId ?? "") || ![match.entryAId, match.entryBId].includes(snapshot.teams.t.entryId ?? "") || snapshot.teams.ct.entryId === snapshot.teams.t.entryId) throw new AppError(ErrorCode.VALIDATION_FAILED, "实时队伍不匹配。");
      if (performance.now() - receivedAt > LIVE_FRAME_BUDGET_MS) return { accepted: false };
      const payload = projectPublicLive(snapshot, authorityRevision, new Date().toISOString());
      if (!admitLiveDelivery(snapshot, authorityRevision)) return { accepted: false };
      const client = createServiceClient({ fetch: liveBroadcastFetch });
      const channel = client.channel(matchLiveTopic(match.id), { config: { private: true } });
      cleanup = () => client.removeChannel(channel);
      try {
        await client.realtime.setAuth();
        const result = await channel.httpSend("snapshot", payload, { timeout: 2000 });
        if (!result.success) throw new Error("broadcast_unavailable");
        return { accepted: true };
      } catch {
        logEvent({ level: "warn", event: "mizar.live.broadcast_unavailable", scope: "match", operation: "broadcast", retryable: true, safeContext: { provider: "supabase" } });
        return { accepted: false };
      }
    });
  } catch (error) {
    // Lock/statement budgets drop this frame. No DB/HTTP replay, including
    // ambiguous connection failures (the shared DB retry owner is unchanged).
    const cause = error instanceof Error && error.cause ? error.cause : error;
    const code = cause && typeof cause === "object" && "code" in cause ? cause.code : undefined;
    if (code === "55P03" || code === "57014") return { accepted: false };
    throw error;
  } finally {
    // Channel never subscribes. Disposal cannot hold DB/authority locks; send did.
    await cleanup?.();
  }
}

/** Scope-limited five-minute JWT. No Auth user or producer credential is created. */
export async function issueLiveViewerToken(matchId: string) {
  const [match] = await db.select({ id: matches.id }).from(matches).innerJoin(seasons, eq(seasons.id, matches.seasonId)).where(and(
    eq(matches.id, matchId),
    eq(matches.status, "in_progress"),
    or(eq(seasons.status, "playing"), and(
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
  return { token: `${unsigned}.${createHmac("sha256", secret).update(unsigned).digest("base64url")}`, topic: matchLiveTopic(matchId), expiresAt: (now + 300) * 1000 };
}
