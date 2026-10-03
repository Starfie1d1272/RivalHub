import "server-only";
import { and, eq, isNull, asc } from "drizzle-orm";
import { db } from "@/db/client";
import { matches, matchMaps, matchLiveSessions, mizarReliableReceipts, mizarInstallations } from "@/db/schema";
import { writeAuditInTx } from "@/lib/audit/write";
import { lockMatchInTx, applyMatchStatusTransitionInTx } from "@/lib/match-rosters/service";
import { recordCanonicalMapResultInTx } from "@/lib/matches/results";
import { AppError, ErrorCode } from "@/lib/errors";
import { assertInstallationInTx, hashCredential } from "./installation";
import { validateObservedLineupInTx } from "./source";
import { parseReliableEventV1 } from "./protocol";

export async function ingestMizarReliable(installationId: string, competitionId: string, input: unknown, authorityRevision: number, lineupSteam64: readonly string[] = []) {
  const event = parseReliableEventV1(input);
  if (event.competitionId !== competitionId || event.cursor.liveSessionId === null) throw new AppError(ErrorCode.FORBIDDEN, "制播数据不属于当前连接。");
  return db.transaction(async tx => {
    await assertInstallationInTx(tx, installationId, competitionId);
    const match = await lockMatchInTx(tx, event.matchId);
    const [source] = await tx.select().from(matchLiveSessions).where(and(eq(matchLiveSessions.matchId, match.id), isNull(matchLiveSessions.closedAt))).for("update");
    if (match.seasonId !== competitionId || match.entryAId !== event.entryAId || match.entryBId !== event.entryBId || !source || source.installationId !== installationId || source.authorityRevision !== authorityRevision || source.producerInstanceId !== event.cursor.producerInstanceId || source.liveSessionId !== event.cursor.liveSessionId) {
      throw new AppError(ErrorCode.FORBIDDEN, "当前数据源或比赛资料已经变化，请重新连接。");
    }
    const eventHash = hashCredential(JSON.stringify(event));
    const [receipt] = await tx.select().from(mizarReliableReceipts).where(and(eq(mizarReliableReceipts.sessionId, source.id), eq(mizarReliableReceipts.idempotencyKey, event.idempotencyKey)));
    if (receipt) {
      if (receipt.eventHash !== eventHash) throw new AppError(ErrorCode.VALIDATION_FAILED, "重复事件内容冲突。");
      return { outcome: receipt.outcome, duplicate: true };
    }
    if (event.contextRevision !== source.contextRevision) throw new AppError(ErrorCode.VALIDATION_FAILED, "比赛资料已经更新，请刷新制播比赛。");
    // One runtime mutation may emit several distinct boundary events at the same cursor.
    // Idempotency keys are checked above; only an older cursor is stale.
    if (event.cursor.runtimeSeq < source.lastReliableSeq) throw new AppError(ErrorCode.VALIDATION_FAILED, "事件已过期。");
    const generationChanged = event.kind === "source_generation_changed" && event.payload.previousSourceGeneration === source.programSourceGeneration && event.cursor.programSourceGeneration > source.programSourceGeneration;
    const epochChanged = event.kind === "map_epoch_changed" && event.payload.previousMapEpoch === source.mapEpoch && event.cursor.mapEpoch > source.mapEpoch;
    if ((!generationChanged && event.cursor.programSourceGeneration !== source.programSourceGeneration) || (!epochChanged && event.cursor.mapEpoch !== source.mapEpoch)) throw new AppError(ErrorCode.VALIDATION_FAILED, "对局数据已过期，请刷新数据源。");
    const now = new Date();
    let outcome = "observed";
    const updates: Partial<typeof matchLiveSessions.$inferInsert> = { lastReliableSeq: event.cursor.runtimeSeq, lastReliableEventAt: now };
    const fresh = event.evidence.identity === "matched" && event.evidence.telemetryFresh && event.evidence.contextFresh;
    if (generationChanged || epochChanged) {
      updates.programSourceGeneration = event.cursor.programSourceGeneration;
      updates.mapEpoch = event.cursor.mapEpoch;
      updates.autoCanonicalizationArmed = false;
      updates.continuityHealth = "unknown";
      updates.mapExecutionPhase = "waiting";
      updates.currentMapId = null;
    } else if (event.kind === "identity_mismatch" || event.kind === "lineup_mismatch") {
      updates.autoCanonicalizationArmed = false;
      if (event.kind === "identity_mismatch") updates.identityHealth = "conflict";
      else updates.lineupHealth = "conflict";
      outcome = "needs_attention";
    } else if (event.kind === "match_started" && match.status === "scheduled") {
      const lineupValid = await validateObservedLineupInTx(tx, match, lineupSteam64);
      if (!fresh || !lineupValid) {
        updates.autoCanonicalizationArmed = false;
        updates.identityHealth = event.evidence.identity === "matched" ? "healthy" : "conflict";
        updates.lineupHealth = lineupValid ? "healthy" : "conflict";
        if (!event.evidence.telemetryFresh || !event.evidence.contextFresh) updates.continuityHealth = "stale";
        outcome = "needs_attention";
      } else {
        await applyMatchStatusTransitionInTx(tx, { matchId: match.id, nextStatus: "in_progress", actorId: installationId, now });
        await writeAuditInTx(tx, { seasonId: competitionId, actorId: installationId, action: "match.start.reality_warning", targetId: match.id, meta: { sessionId: source.id } });
        updates.identityHealth = "healthy";
        updates.lineupHealth = "healthy";
        updates.continuityHealth = "healthy";
        outcome = "canonicalized";
      }
    } else if (event.kind === "map_started") {
      const [map] = await tx.select().from(matchMaps).where(eq(matchMaps.matchId, match.id)).orderBy(asc(matchMaps.mapOrder)).then(rows => rows.filter(map => map.completedAt === null));
      const validMap = Boolean(map && map.mapName === event.mapName && (event.mapId === null || map.id === event.mapId));
      const lineupValid = await validateObservedLineupInTx(tx, match, lineupSteam64);
      const mayArm = match.status === "in_progress" && fresh && validMap && lineupValid && source.manualTakeoverMapEpoch !== event.cursor.mapEpoch;
      updates.autoCanonicalizationArmed = mayArm;
      updates.identityHealth = event.evidence.identity === "matched" ? "healthy" : "conflict";
      updates.lineupHealth = lineupValid ? "healthy" : "conflict";
      updates.continuityHealth = !validMap ? "conflict" : !event.evidence.telemetryFresh || !event.evidence.contextFresh ? "stale" : "healthy";
      updates.currentMapId = validMap ? map!.id : null;
      updates.mapExecutionPhase = mayArm ? "gameplay" : "waiting";
      outcome = mayArm ? "armed" : "needs_attention";
    } else if (event.kind === "map_ended") {
      const [map] = await tx.select().from(matchMaps).where(and(eq(matchMaps.matchId, match.id), eq(matchMaps.mapName, event.mapName ?? "")));
      const sameExecution = Boolean(map && source.currentMapId === map.id && (event.mapId === null || event.mapId === map.id));
      if (fresh && sameExecution && map!.completedAt !== null) {
        outcome = map!.scoreA === event.payload.scoreA && map!.scoreB === event.payload.scoreB ? "consistent" : "needs_attention";
        if (outcome === "needs_attention") { updates.continuityHealth = "result_conflict"; updates.autoCanonicalizationArmed = false; }
      } else if (!fresh || !source.autoCanonicalizationArmed || source.manualTakeoverMapEpoch === event.cursor.mapEpoch || !sameExecution) {
        updates.autoCanonicalizationArmed = false;
        if (event.evidence.identity !== "matched") updates.identityHealth = "conflict";
        else if (!event.evidence.telemetryFresh || !event.evidence.contextFresh) updates.continuityHealth = "stale";
        outcome = "needs_attention";
      } else {
        // A/B are producer-owned CompetitionEntry-relative candidates. CT/T are evidence only.
        await recordCanonicalMapResultInTx(tx, { matchId: match.id, mapOrder: map!.mapOrder, mapName: map!.mapName, scoreA: event.payload.scoreA, scoreB: event.payload.scoreB, pickedByEntryId: null, teamAStartSide: null, actorId: installationId });
        updates.mapExecutionPhase = "inter_map";
        outcome = "canonicalized";
      }
    } else if (event.kind === "series_ended") {
      const [current] = await tx.select().from(matches).where(eq(matches.id, match.id));
      outcome = current.status === "finished" && current.scoreA === event.payload.scoreA && current.scoreB === event.payload.scoreB ? "consistent" : "needs_attention";
      if (outcome === "needs_attention") { updates.continuityHealth = "result_conflict"; updates.autoCanonicalizationArmed = false; }
    }
    await tx.update(matchLiveSessions).set(updates).where(eq(matchLiveSessions.id, source.id));
    await tx.update(mizarInstallations).set({ lastSeenAt: now }).where(eq(mizarInstallations.id, installationId));
    await tx.insert(mizarReliableReceipts).values({ sessionId: source.id, idempotencyKey: event.idempotencyKey, eventHash, kind: event.kind, outcome });
    await writeAuditInTx(tx, { seasonId: competitionId, actorId: installationId, action: "mizar.reliable.accept", targetId: match.id, meta: { kind: event.kind, outcome, ...(event.kind === "map_ended" ? event.payload : {}) } });
    return { outcome, duplicate: false };
  });
}
