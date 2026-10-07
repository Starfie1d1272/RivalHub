import "server-only";
import { eq } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { seasons, matches, matchMaps, matchVetoSessions } from "@/db/schema";
import { writeAuditInTx } from "@/lib/audit/write";
import { AppError, ErrorCode } from "@/lib/errors";
import { lockMatchInTx } from "./locking";
import { normalizeRegistrationConfig } from "@/lib/seasons/compatibility";
import { getMaxMaps } from "@/types/match";
import { computeSeriesScoreAfterMap, validateMapScore, validateSeriesAgainstMaps } from "./result-rules";
import { persistCompletedMatchInTx } from "./completion";
import { finishCompetitionSeriesInTx } from "./competition-results";

export { finishCompetitionSeriesInTx as finishCanonicalSeriesInTx } from "./competition-results";

export interface CanonicalMapResultCommand {
  matchId: string; mapOrder: number; mapName: string; scoreA: number; scoreB: number;
  pickedByEntryId: string | null; teamAStartSide: "t" | "ct" | null; actorId: string;
}

/** Shared by manual operator input and validated Mizar reliable candidates. */
export async function recordCanonicalMapResultInTx(tx: TxDb, command: CanonicalMapResultCommand) {
  return recordMapResultInTx(tx, command, false);
}

/** Late evidence for an ended independent match; never reopens execution. */
export async function supplementUnassociatedMapResultInTx(tx: TxDb, command: CanonicalMapResultCommand) {
  return recordMapResultInTx(tx, command, true);
}

async function recordMapResultInTx(tx: TxDb, command: CanonicalMapResultCommand, supplement: boolean) {
  const { matchId, mapOrder, mapName, scoreA, scoreB, pickedByEntryId, teamAStartSide, actorId } = command;
  validateMapScore(scoreA, scoreB);
      let finishedSlug: string | null = null;
      const locked = await lockMatchInTx(tx, matchId);
      const lateEvidence = supplement && locked.seasonId === null && locked.status === "finished" && (locked.resultDisposition === "pending" || locked.resultDisposition === "recorded");
      if (supplement ? !lateEvidence : locked.status !== "in_progress") throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "比赛状态不允许录入地图结果");
      let lockedPool: readonly string[];
      if (locked.seasonId !== null) {
        const vetoSession = await tx.query.matchVetoSessions.findFirst({ where: eq(matchVetoSessions.matchId, matchId), columns: { completedAt: true } });
        if (!vetoSession?.completedAt) throw new AppError(ErrorCode.VALIDATION_FAILED, "请先完成 BP 地图计划，再录入地图结果");
        const [season] = await tx.select().from(seasons).where(eq(seasons.id, locked.seasonId)).for("update");
        if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛季不存在");
        lockedPool = normalizeRegistrationConfig(season.registrationConfig).mapPool;
      } else {
        if (!locked.executionContext) throw new AppError(ErrorCode.VALIDATION_FAILED, "比赛缺少本场规则。");
        if (pickedByEntryId !== null) throw new AppError(ErrorCode.VALIDATION_FAILED, "独立比赛不能引用赛事参赛队。");
        lockedPool = locked.executionContext.mapPool;
      }
      if (!lockedPool.includes(mapName)) throw new AppError(ErrorCode.MATCH_MAP_INVALID, "地图不在本场图池中");
      const lockedMaxMaps = getMaxMaps(locked.format);
      if (mapOrder < 1 || mapOrder > lockedMaxMaps) throw new AppError(ErrorCode.VALIDATION_FAILED, `${locked.format.toUpperCase()} 图序号须在 1-${lockedMaxMaps} 之间`);
      // 事务内读快照
      const existingMaps = await tx.query.matchMaps.findMany({
        where: eq(matchMaps.matchId, matchId),
      });
      const existingOrderRow = existingMaps.find((m) => m.mapOrder === mapOrder);
      const existingNameRow = existingMaps.find((m) => m.mapName === mapName);
      if (existingOrderRow && existingOrderRow.mapName !== mapName) {
        throw new AppError(ErrorCode.MATCH_MAP_INVALID, `第 ${mapOrder} 图应为 ${existingOrderRow.mapName}，不能写入 ${mapName}`);
      }
      if (existingNameRow && existingNameRow.mapOrder !== mapOrder) {
        throw new AppError(ErrorCode.MATCH_MAP_INVALID, `地图 ${mapName} 属于第 ${existingNameRow.mapOrder} 图，不能写入第 ${mapOrder} 图`);
      }
      const existingRow = existingOrderRow ?? existingNameRow;
      if (existingMaps.some((m) => (m.scoreA === null) !== (m.scoreB === null))) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, "地图比分数据不完整，无法继续录入");
      }
      if (existingRow && existingRow.scoreA !== null) {
        if (lateEvidence && existingRow.scoreA === scoreA && existingRow.scoreB === scoreB && (teamAStartSide === null || teamAStartSide === existingRow.teamAStartSide)) return { seriesFinished: locked.resultDisposition === "recorded", finishedSlug, seasonId: locked.seasonId };
        throw new AppError(ErrorCode.VALIDATION_FAILED, `地图 ${mapName} 已录入比分`);
      }

      const seriesScore = computeSeriesScoreAfterMap(locked.format, existingMaps, scoreA, scoreB);
      const { mapWinsA, mapWinsB } = seriesScore;
      const nextFacts = [...existingMaps.filter(map => map.id !== existingRow?.id), { mapOrder, scoreA, scoreB }];
      const scoredOrders = nextFacts.filter(map => map.scoreA !== null && map.scoreB !== null).map(map => map.mapOrder).sort((a, b) => a - b);
      const completePrefix = scoredOrders.every((order, index) => order === index + 1);
      // A late map can arrive before an earlier map. Unknown games are not zero wins.
      const seriesFinished = seriesScore.seriesFinished && (locked.seasonId !== null || completePrefix);

      if (locked.seasonId === null && locked.resultDisposition === "recorded" && locked.scoreA !== null && locked.scoreB !== null) validateSeriesAgainstMaps(locked.format, locked.scoreA, locked.scoreB, [...existingMaps.filter(map => map.id !== existingRow?.id), { mapOrder, scoreA, scoreB }]);
      if (seriesFinished && locked.seasonId === null && locked.resultDisposition !== "recorded") validateSeriesAgainstMaps(locked.format, mapWinsA, mapWinsB, [...existingMaps.filter(map => map.id !== existingRow?.id), { mapOrder, scoreA, scoreB }]);

      if (existingRow) {
        // BP 预占行：填入比分（pickedByEntryId / teamAStartSide 保留 BP 记录，除非调用方覆盖）
        await tx.update(matchMaps)
          .set({
            scoreA,
            scoreB,
            pickedByEntryId: pickedByEntryId ?? existingRow.pickedByEntryId,
            teamAStartSide: teamAStartSide ?? existingRow.teamAStartSide,
            completedAt: new Date(),
          })
          .where(eq(matchMaps.id, existingRow.id));
      } else {
        await tx.insert(matchMaps).values({
          matchId,
          mapOrder,
          mapName,
          pickedByEntryId,
          teamAStartSide,
          scoreA,
          scoreB,
          completedAt: new Date(),
        });
      }

      if (seriesFinished && locked.resultDisposition !== "recorded") {
        const completion = { match: locked, scoreA: mapWinsA, scoreB: mapWinsB, completedAt: new Date() };
        if (locked.seasonId) finishedSlug = await finishCompetitionSeriesInTx(tx, completion);
        else await persistCompletedMatchInTx(tx, completion);
      }

      if (lateEvidence) await tx.update(matches).set({ updatedAt: new Date() }).where(eq(matches.id, matchId));
      await writeAuditInTx(tx, {
        seasonId: locked.seasonId,
        action: "match.record_map_result",
        actorId: actorId,
        targetId: matchId,meta: { operation: supplement ? "supplement_map_result" : "record_map_result", mapOrder, mapName, scoreA, scoreB, seriesFinished, before: { disposition: locked.resultDisposition, scoreA: locked.scoreA, scoreB: locked.scoreB }, after: seriesFinished && locked.resultDisposition !== "recorded" ? { disposition: locked.seasonId === null ? "recorded" : locked.resultDisposition, scoreA: mapWinsA, scoreB: mapWinsB } : { disposition: locked.resultDisposition, scoreA: locked.scoreA, scoreB: locked.scoreB } },
      });
      return { seriesFinished, finishedSlug, seasonId: locked.seasonId };
}
