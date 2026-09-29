import "server-only";
import { eq, and, isNull } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { seasons, matches, matchMaps, matchVetoSessions } from "@/db/schema";
import { writeAuditInTx } from "@/lib/audit/write";
import { AppError, ErrorCode } from "@/lib/errors";
import { lockMatchInTx } from "@/lib/match-rosters/service";
import { advanceStageBracket, ensureResolvedBracketMatch, loadStageBracketState, saveStageBracketState, type ResolvedBracketMatch } from "@/lib/bracket";
import { resolveMatchFormat } from "@/lib/match-transitions";
import { normalizeRegistrationConfig, normalizeStagePlan } from "@/lib/seasons/compatibility";
import { getMaxMaps } from "@/types/match";
import { computeSeriesScoreAfterMap, validateMapScore } from "./result-rules";
import { maybeFinishSeason } from "@/lib/seasons/transitions";
import { completeCompetitionQualificationIfReadyInTx } from "@/lib/competition-qualification/runtime";

/** Persist provider-resolved nodes through the fail-closed bracket boundary. */
async function insertResolvedBracketMatches(
  tx: TxDb,
  seasonId: string,
  stageKey: string,
  resolvedMatches: ResolvedBracketMatch[],
  stagePlan: ReturnType<typeof normalizeStagePlan>,
) {
  for (const resolved of resolvedMatches) {
    await ensureResolvedBracketMatch(tx, {
      seasonId,
      stageKey,
      resolved,
      format: resolveMatchFormat(stagePlan, stageKey, resolved.roundNumber, resolved.groupNumber),
    });
  }
}


export interface CanonicalMapResultCommand {
  matchId: string; mapOrder: number; mapName: string; scoreA: number; scoreB: number;
  pickedByEntryId: string | null; teamAStartSide: "t" | "ct" | null; actorId: string;
}

/** Shared by manual operator input and validated Mizar reliable candidates. */
export async function recordCanonicalMapResultInTx(tx: TxDb, command: CanonicalMapResultCommand) {
  const { matchId, mapOrder, mapName, scoreA, scoreB, pickedByEntryId, teamAStartSide, actorId } = command;
  validateMapScore(scoreA, scoreB);
      let finishedSlug: string | null = null;
      const locked = await lockMatchInTx(tx, matchId);
      if (locked.status !== "in_progress") throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "比赛状态不允许录入地图结果");
      const vetoSession = await tx.query.matchVetoSessions.findFirst({
        where: eq(matchVetoSessions.matchId, matchId),
        columns: { completedAt: true },
      });
      if (!vetoSession?.completedAt) throw new AppError(ErrorCode.VALIDATION_FAILED, "请先完成 BP 地图计划，再录入地图结果");
      const [lockedSeason] = await tx.select().from(seasons).where(eq(seasons.id, locked.seasonId)).for("update");
      if (!lockedSeason) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛季不存在");
      const bracketState = locked.bracketNodeId
        ? await loadStageBracketState(tx, locked.seasonId, locked.stage)
        : null;
      const lockedPool = normalizeRegistrationConfig(lockedSeason.registrationConfig).mapPool;
      if (!lockedPool.includes(mapName)) throw new AppError(ErrorCode.MATCH_MAP_INVALID, "地图不在当前赛季图池中");
      const lockedMaxMaps = getMaxMaps(locked.format);
      if (mapOrder < 1 || mapOrder > lockedMaxMaps) throw new AppError(ErrorCode.VALIDATION_FAILED, `${locked.format.toUpperCase()} 图序号须在 1-${lockedMaxMaps} 之间`);
      // 事务内读快照
      const existingMaps = await tx.query.matchMaps.findMany({
        where: eq(matchMaps.matchId, matchId),
      });
      const existingRow = existingMaps.find((m) => m.mapName === mapName);
      if (existingMaps.some((m) => (m.scoreA === null) !== (m.scoreB === null))) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, "地图比分数据不完整，无法继续录入");
      }
      if (existingRow && existingRow.scoreA !== null) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, `地图 ${mapName} 已录入比分`);
      }

      const seriesScore = computeSeriesScoreAfterMap(locked.format, existingMaps, scoreA, scoreB);
      const { mapWinsA, mapWinsB } = seriesScore;
      const seriesFinished = seriesScore.seriesFinished;

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

      if (seriesFinished) {
        await tx.delete(matchMaps).where(
          and(eq(matchMaps.matchId, matchId), isNull(matchMaps.scoreA), isNull(matchMaps.scoreB))
        );

        await tx.update(matches).set({
          scoreA: mapWinsA,
          scoreB: mapWinsB,
          status: "finished",
          completedAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(matches.id, matchId));

        if (locked.qualificationRunId) {
          await completeCompetitionQualificationIfReadyInTx(tx, locked.qualificationRunId);
        }

        if (bracketState && locked.bracketNodeId) {
          const { updatedData, newResolvedMatches } = await advanceStageBracket(
            locked.stage,
            locked.bracketNodeId,
            { scoreA: mapWinsA, scoreB: mapWinsB },
            bracketState,
          );
          await saveStageBracketState(tx, locked.seasonId, locked.stage, updatedData);
          await insertResolvedBracketMatches(
            tx, locked.seasonId, locked.stage, newResolvedMatches,
            normalizeStagePlan(lockedSeason.stagePlan),
          );
        }

        finishedSlug = await maybeFinishSeason(tx, locked.seasonId);
      }

      await writeAuditInTx(tx, {
        seasonId: locked.seasonId,
        action: "match.record_map_result",
        actorId: actorId,
        targetId: matchId,meta: { mapOrder, mapName, scoreA, scoreB, seriesFinished },
      });
      return { seriesFinished, finishedSlug, seasonId: locked.seasonId };
}
