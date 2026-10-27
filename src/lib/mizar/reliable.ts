import "server-only";
import { mizarAuditActorId } from "@/lib/audit/people";
import { and, eq, isNull, asc } from "drizzle-orm";
import { db } from "@/db/client";
import { matches, matchMaps, matchLiveSessions, mizarReliableReceipts, matchVetoSessions } from "@/db/schema";
import { writeAuditInTx } from "@/lib/audit/write";
import { lockMatchInTx, applyMatchStatusTransitionInTx } from "@/lib/match-rosters/service";
import { startCanonicalMapInTx } from "@/lib/matches/map-start";
import { recordCanonicalMapResultInTx } from "@/lib/matches/results";
import { getDisplayName } from "@/lib/identity/display-name";
import { loadEffectiveMatchRoster } from "@/lib/match-rosters/effective";
import { beginRuntimeResource } from "@/lib/observability/runtime-resources";
import { AppError, ErrorCode } from "@/lib/errors";
import { touchMizarInstallation } from "./heartbeat";
import { assertInstallationInTx, hashCredential } from "./installation";
import { validateObservedLineupInTx } from "./source";
import { parseReliableEventV1 } from "./protocol";
import { loadMizarMatchDocumentInTx } from "./context";
import { isLineupMismatchOnly, LINEUP_REVIEW_REQUIRED } from "./lineup-display";

export async function ingestMizarReliable(installationId: string, competitionId: string, input: unknown, authorityRevision: number, lineupSteam64: readonly string[] = []) {
  const event = parseReliableEventV1(input);
  if (event.competitionId !== competitionId || event.cursor.liveSessionId === null) throw new AppError(ErrorCode.FORBIDDEN, "制播数据不属于当前连接。");
  const finishResource = beginRuntimeResource("mizar.reliable");
  try {
    const result = await db.transaction(async tx => {
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
      if (event.kind === "map_player_snapshot") {
        const [parent] = await tx.select().from(mizarReliableReceipts).where(and(eq(mizarReliableReceipts.sessionId, source.id), eq(mizarReliableReceipts.idempotencyKey, event.payload.mapEndedKey)));
        const scope = parent?.mapEndScope;
        const [priorSnapshot] = await tx.select().from(mizarReliableReceipts).where(and(eq(mizarReliableReceipts.sessionId, source.id), eq(mizarReliableReceipts.parentEventKey, event.payload.mapEndedKey)));
        if (priorSnapshot) throw new AppError(ErrorCode.VALIDATION_FAILED, "地图结束事件已有临时数据。");
        if (!scope || parent.kind !== "map_ended" || !["canonicalized", "consistent"].includes(parent.outcome)
          || scope.receivedMapId !== event.mapId || scope.mapName !== event.mapName || scope.contextRevision !== event.contextRevision
          || scope.producerInstanceId !== event.cursor.producerInstanceId || scope.liveSessionId !== event.cursor.liveSessionId
          || scope.programSourceGeneration !== event.cursor.programSourceGeneration || scope.mapEpoch !== event.cursor.mapEpoch || scope.runtimeSeq !== event.cursor.runtimeSeq
          || !event.evidence.telemetryFresh || !event.evidence.contextFresh || event.evidence.identity !== "matched") {
          throw new AppError(ErrorCode.VALIDATION_FAILED, "临时数据与已确认的地图结束事件不匹配。");
        }
        const [map] = await tx.select().from(matchMaps).where(and(eq(matchMaps.id, scope.mapId), eq(matchMaps.matchId, match.id)));
        if (!map || map.completedAt === null) throw new AppError(ErrorCode.VALIDATION_FAILED, "临时数据地图不可用。");
        const roster = await loadEffectiveMatchRoster(tx, [match.id]);
        const players = event.payload.players.flatMap(player => {
          const candidates = roster.filter(r => r.userId === player.canonicalPlayerId && r.steam64 === player.sourcePlayerId);
          if (candidates.length !== 1) return [];
          const resolved = candidates[0]!;
          return [{ userId: resolved.userId, name: getDisplayName(resolved), kills: player.kills, deaths: player.deaths, assists: player.assists }];
        });
        if (players.length && new Set(players.map(p => p.userId)).size === players.length) await tx.update(matchMaps).set({ provisionalPlayers: players }).where(eq(matchMaps.id, map.id));
        const outcome = players.length ? "observed" : "needs_attention";
        await tx.insert(mizarReliableReceipts).values({ sessionId: source.id, idempotencyKey: event.idempotencyKey, eventHash, kind: event.kind, outcome, parentEventKey: event.payload.mapEndedKey });
        await writeAuditInTx(tx, { seasonId: competitionId, actorId: mizarAuditActorId(installationId), action: "mizar.reliable.accept", targetId: match.id, meta: { kind: event.kind, outcome, sessionId: source.id, mapEpoch: scope.mapEpoch, currentMapId: map.id } });
        return { outcome, duplicate: false };
      }
      // A refreshed producer may advance to the current website document without
      // relinquishing its source. Never adopt an arbitrary or stale revision.
      if (event.contextRevision !== source.contextRevision) {
        const context = await loadMizarMatchDocumentInTx(tx, match.id, competitionId);
        if (event.contextRevision !== context.revision) throw new AppError(ErrorCode.VALIDATION_FAILED, "比赛资料已经更新，请刷新制播比赛。");
      }
      // One runtime mutation may emit several distinct boundary events at the same cursor.
      // Idempotency keys are checked above; only an older cursor is stale.
      if (event.cursor.runtimeSeq < source.lastReliableSeq) throw new AppError(ErrorCode.VALIDATION_FAILED, "事件已过期。");
      const generationChanged = event.kind === "source_generation_changed" && event.payload.previousSourceGeneration === source.programSourceGeneration && event.cursor.programSourceGeneration > source.programSourceGeneration;
      const epochChanged = event.kind === "map_epoch_changed" && event.payload.previousMapEpoch === source.mapEpoch && event.cursor.mapEpoch > source.mapEpoch;
      if ((!generationChanged && event.cursor.programSourceGeneration !== source.programSourceGeneration) || (!epochChanged && event.cursor.mapEpoch !== source.mapEpoch)) throw new AppError(ErrorCode.VALIDATION_FAILED, "对局数据已过期，请刷新数据源。");
      const now = new Date();
      let outcome = "observed";
      let mapEndScope: typeof mizarReliableReceipts.$inferInsert.mapEndScope;
      const updates: Partial<typeof matchLiveSessions.$inferInsert> = { contextRevision: event.contextRevision, lastReliableSeq: event.cursor.runtimeSeq, lastReliableEventAt: now };
      const reviewRequired = source.lineupHealth === LINEUP_REVIEW_REQUIRED || event.kind === "lineup_mismatch" || isLineupMismatchOnly(event.evidence);
      if (reviewRequired) { updates.lineupHealth = LINEUP_REVIEW_REQUIRED; updates.autoCanonicalizationArmed = false; }
      const fresh = event.evidence.identity === "matched" && event.evidence.telemetryFresh && event.evidence.contextFresh;
      if (generationChanged || epochChanged) {
        updates.programSourceGeneration = event.cursor.programSourceGeneration;
        updates.mapEpoch = event.cursor.mapEpoch;
        updates.autoCanonicalizationArmed = false;
        updates.continuityHealth = "unknown";
        updates.mapExecutionPhase = "waiting";
        if (!reviewRequired) updates.currentMapId = null;
        else if (source.mapExecutionPhase === "inter_map" || source.mapExecutionPhase === "awaiting_next_map") updates.mapExecutionPhase = epochChanged ? "awaiting_next_map" : source.mapExecutionPhase;
      } else if (event.kind === "identity_mismatch" || event.kind === "lineup_mismatch") {
        updates.autoCanonicalizationArmed = false;
        if (event.kind === "identity_mismatch") updates.identityHealth = "conflict";
        else updates.lineupHealth = reviewRequired ? LINEUP_REVIEW_REQUIRED : "conflict";
        outcome = "needs_attention";
      } else if (event.kind === "match_started" && match.status === "scheduled") {
        const lineupValid = await validateObservedLineupInTx(tx, match, lineupSteam64);
        if (!fresh || !lineupValid || reviewRequired) {
          updates.autoCanonicalizationArmed = false;
          updates.identityHealth = event.evidence.identity === "matched" ? "healthy" : "conflict";
          updates.lineupHealth = reviewRequired ? LINEUP_REVIEW_REQUIRED : lineupValid ? "healthy" : "conflict";
          if (!event.evidence.telemetryFresh || !event.evidence.contextFresh) updates.continuityHealth = "stale";
          outcome = "needs_attention";
        } else {
          await applyMatchStatusTransitionInTx(tx, { matchId: match.id, nextStatus: "in_progress", actorId: mizarAuditActorId(installationId), now });
          await writeAuditInTx(tx, { seasonId: competitionId, actorId: mizarAuditActorId(installationId), action: "match.start.reality_warning", targetId: match.id, meta: { sessionId: source.id } });
          updates.identityHealth = "healthy";
          updates.lineupHealth = "healthy";
          updates.continuityHealth = "healthy";
          outcome = "canonicalized";
        }
      } else if (event.kind === "map_started") {
        const maps = await tx.select().from(matchMaps).where(eq(matchMaps.matchId, match.id)).orderBy(asc(matchMaps.mapOrder));
        const displayMap = reviewRequired ? maps.find(map => map.id === source.currentMapId) : undefined;
        const map = displayMap
          ? source.mapExecutionPhase === "awaiting_next_map" ? maps.find(map => map.mapOrder === displayMap.mapOrder + 1 && map.completedAt === null) : source.mapExecutionPhase === "inter_map" ? undefined : displayMap
          : maps.find(map => map.completedAt === null);
        const validMap = Boolean(map && map.mapName === event.mapName && (event.mapId === null || map.id === event.mapId));
        const lineupValid = await validateObservedLineupInTx(tx, match, lineupSteam64);
        const executionConflict = source.continuityHealth === "execution_conflict";
        const veto = await tx.query.matchVetoSessions.findFirst({ where: eq(matchVetoSessions.matchId, match.id), columns: { completedAt: true } });
        const observedLineup = isLineupMismatchOnly(event.evidence) && event.evidence.telemetryFresh && event.evidence.contextFresh
          && lineupSteam64.length === 10 && new Set(lineupSteam64).size === 10 && lineupSteam64.every(id => /^\d{17}$/.test(id))
          && !lineupValid && validMap && Boolean(veto?.completedAt) && match.status === "in_progress"
          && !executionConflict && source.manualTakeoverMapEpoch !== event.cursor.mapEpoch;
        const displayOnly = reviewRequired || observedLineup;
        const displayReady = displayOnly && validMap && map!.completedAt === null && Boolean(veto?.completedAt)
          && match.status === "in_progress" && (fresh && lineupValid || observedLineup) && !executionConflict
          && source.manualTakeoverMapEpoch !== event.cursor.mapEpoch;
        const mayArm = !displayOnly && Boolean(veto?.completedAt) && (!executionConflict || event.cursor.runtimeSeq > source.lastReliableSeq) && match.status === "in_progress" && fresh && validMap && lineupValid && source.manualTakeoverMapEpoch !== event.cursor.mapEpoch;
        updates.autoCanonicalizationArmed = mayArm;
        updates.identityHealth = event.evidence.identity === "matched" || displayReady ? "healthy" : "conflict";
        updates.lineupHealth = displayOnly ? LINEUP_REVIEW_REQUIRED : lineupValid ? "healthy" : "conflict";
        updates.continuityHealth = !validMap || (executionConflict && !mayArm) ? "execution_conflict" : !event.evidence.telemetryFresh || !event.evidence.contextFresh ? "stale" : "healthy";
        // An invalid observation cannot erase the trusted execution or a manual binding.
        // A complete, current start observation can revalidate AUTO; an explicit
        // manual choice remains authoritative for this epoch. End events never re-arm.
        if (validMap && (!executionConflict || mayArm)) {
          updates.currentMapId = map!.id;
          if (displayReady) updates.mapExecutionPhase = "gameplay";
          if (!displayOnly && fresh && lineupValid && match.status === "in_progress") {
            await startCanonicalMapInTx(tx,match.id,map!.id,mizarAuditActorId(installationId));
            updates.mapExecutionPhase = "gameplay";
          }
        }
        outcome = mayArm ? "armed" : "needs_attention";
      } else if (event.kind === "map_ended") {
        const [map] = await tx.select().from(matchMaps).where(and(eq(matchMaps.matchId, match.id), eq(matchMaps.mapName, event.mapName ?? "")));
        const sameExecution = Boolean(map && source.currentMapId === map.id && (event.mapId === null || event.mapId === map.id));
        if (reviewRequired) {
          updates.autoCanonicalizationArmed = false;
          outcome = "needs_attention";
          if (sameExecution && (fresh || isLineupMismatchOnly(event.evidence)) && event.evidence.telemetryFresh && event.evidence.contextFresh) updates.mapExecutionPhase = "inter_map";
        } else if (fresh && sameExecution && map!.completedAt !== null) {
          outcome = map!.scoreA === event.payload.scoreA && map!.scoreB === event.payload.scoreB ? "consistent" : "needs_attention";
          if (outcome === "needs_attention") { updates.continuityHealth = "result_conflict"; updates.autoCanonicalizationArmed = false; }
        } else if (!fresh || !source.autoCanonicalizationArmed || source.manualTakeoverMapEpoch === event.cursor.mapEpoch || !sameExecution) {
          updates.autoCanonicalizationArmed = false;
          if (event.evidence.identity !== "matched") updates.identityHealth = "conflict";
          if (!sameExecution || source.continuityHealth === "execution_conflict") updates.continuityHealth = "execution_conflict";
          else if (!event.evidence.telemetryFresh || !event.evidence.contextFresh) updates.continuityHealth = "stale";
          outcome = "needs_attention";
        } else {
          // A/B are producer-owned CompetitionEntry-relative candidates. CT/T are evidence only.
          await recordCanonicalMapResultInTx(tx, { matchId: match.id, mapOrder: map!.mapOrder, mapName: map!.mapName, scoreA: event.payload.scoreA, scoreB: event.payload.scoreB, pickedByEntryId: null, teamAStartSide: null, actorId: mizarAuditActorId(installationId) });
          updates.mapExecutionPhase = "inter_map";
          outcome = "canonicalized";
        }
        if (sameExecution && (outcome === "canonicalized" || outcome === "consistent")) {
          mapEndScope = { mapId: map!.id, receivedMapId: event.mapId, mapName: event.mapName, contextRevision: event.contextRevision, producerInstanceId: event.cursor.producerInstanceId, liveSessionId: event.cursor.liveSessionId, programSourceGeneration: event.cursor.programSourceGeneration, mapEpoch: event.cursor.mapEpoch, runtimeSeq: event.cursor.runtimeSeq };
        }
      } else if (event.kind === "series_ended") {
        const [current] = await tx.select().from(matches).where(eq(matches.id, match.id));
        outcome = current.status === "finished" && current.scoreA === event.payload.scoreA && current.scoreB === event.payload.scoreB ? "consistent" : "needs_attention";
        if (outcome === "needs_attention") { updates.continuityHealth = "result_conflict"; updates.autoCanonicalizationArmed = false; }
      }
      const observed = [...lineupSteam64];
      const expectedPlayers = outcome === "needs_attention" && observed.length > 0
        ? (await loadEffectiveMatchRoster(tx, [match.id])).filter(player => player.isStarter) : [];
      const lineupDifference = expectedPlayers.length ? {
        missing: expectedPlayers.filter(player => !player.steam64 || !observed.includes(player.steam64)).map(player => ({ name: getDisplayName(player), userId: player.userId, steam64: player.steam64 })),
        unexpected: observed.filter(id => !expectedPlayers.some(player => player.steam64 === id)),
        duplicated: [...new Set(observed.filter((id, index) => observed.indexOf(id) !== index))],
      } : null;
      if (source.continuityHealth === "execution_conflict" && outcome === "armed") {
        await writeAuditInTx(tx, { seasonId: competitionId, actorId: mizarAuditActorId(installationId), action: "mizar.map.revalidated", targetId: match.id,
          meta: { sessionId: source.id, mapEpoch: source.mapEpoch, mapId: updates.currentMapId, programSourceGeneration: source.programSourceGeneration, runtimeSeq: event.cursor.runtimeSeq } });
      }
      await tx.update(matchLiveSessions).set(updates).where(eq(matchLiveSessions.id, source.id));
      await tx.insert(mizarReliableReceipts).values({ sessionId: source.id, idempotencyKey: event.idempotencyKey, eventHash, kind: event.kind, outcome, mapEndScope });
      await writeAuditInTx(tx, { seasonId: competitionId, actorId: mizarAuditActorId(installationId), action: "mizar.reliable.accept", targetId: match.id, meta: { kind: event.kind, outcome, lineupDifference, ...(event.kind === "identity_mismatch" || event.kind === "lineup_mismatch" ? { reason: event.payload.reason } : {}), sessionId: source.id, mapEpoch: source.mapEpoch, currentMapId: source.currentMapId, receivedMapId: event.mapId, receivedMapName: event.mapName, continuityHealth: updates.continuityHealth ?? source.continuityHealth, ...(event.kind === "map_ended" ? { scoreA: event.payload.scoreA, scoreB: event.payload.scoreB, scoreCT: event.payload.scoreCT, scoreT: event.payload.scoreT } : {}) } });
      return { outcome, duplicate: false };
    });
    await touchMizarInstallation(installationId, competitionId);
    return result;
  } finally { finishResource(); }
}
