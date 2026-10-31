"use server";
import { lockMatchForEvidenceInTx } from "@/lib/matches/locking";
import { assertCompetitionMatch } from "@/lib/matches/competition-context";

import { writeAuditInTx } from "@/lib/audit/write";

import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db/client";
import { isScoreboardRoundConsistent } from "@/lib/matches/scoreboard-completeness";
import { matchMaps } from "@/db/schema/match-maps";
import { matches } from "@/db/schema/matches";
import { matchPlayerStats } from "@/db/schema/player-stats";
import { matchMvpVotes } from "@/db/schema/mvp-votes";
import { matchRosters, matchRosterPlayers } from "@/db/schema/match-rosters";
import { users } from "@/db/schema/users";
import { eventRosterMembers } from "@/db/schema/competition-entries";
import { ok, fail, type ActionResult } from "@/types/action";
import { AppError, ErrorCode, ERROR_MESSAGES } from "@/lib/errors";
import { actionError } from "@/lib/action-utils";
import { isPgUniqueViolation } from "@/db/errors";
import { captureException } from "@/lib/observability/server";
import { readMatchMvpResults } from "@/lib/matches/mvp";
import { MVP_DEADLINE_MS } from "@/lib/utils/date";
import { extractScoreboardFromBase64 } from "@/lib/ocr";
import type { PlayerRowOCR } from "@/lib/ocr";
import { OCRFailure, presentOCRFailure } from "@/lib/ocr/errors";
import { requireSeasonAdmin, auditActorId, requireAuth } from "@/lib/auth/session";
import { revalidatePath } from "next/cache";
import { updatePublicStatsTag } from "@/lib/revalidation";
import { isStatOutOfRange } from "@/lib/config/stat-ranges";
import { canConfirmMapScoreboard } from "@/lib/matches/map-scoreboard";
import { z } from "zod";
import { playerRowSchema } from "@/lib/ocr/types";
import {
  loadScoreboardPlayers,
  clearOperatorScoreboardInTx,
  loadOperatorScoreboard,
  loadOperatorScoreboardSnapshot,
  type OperatorScoreboardRow,
} from "@/lib/matches/operator-scoreboard";
import { applyOcrScoreboardEnrichment } from "@/lib/matches/scoreboard-ownership";

import type { AuthorizedScoreboardSnapshot, ScoreboardCommand, ScoreboardOperation, ScoreboardReceiptStatus } from "@/lib/ocr/scoreboard-contract";
import { ScoreboardConflict, assertScoreboardActor, assertScoreboardReplay, assertScoreboardVersion, commitScoreboardReceipt, findScoreboardReceipt, presentScoreboardReceipt } from "@/lib/ocr/scoreboard-receipts";
import { scoreboardPayloadDigest, scoreboardVersion, scoreboardVersionColumns } from "@/lib/ocr/scoreboard-version";

const scoreboardCommandSchema = z.object({ operationId: z.uuid(), expectedActor: z.uuid(), expectedVersion: z.string().regex(/^[a-f0-9]{64}$/) });
function scoreboardFailure(operation: string, error: unknown) {
  return error instanceof ScoreboardConflict
    ? fail({ code: error.code, message: error.message, meta: { outcome: "conflict" } })
    : actionError(operation, error);
}

export type PlayerStatsDraft = PlayerRowOCR & {
  userId: string | null;
};

export type PlayerOption = {
  userId: string;
  perfectName: string;
};

async function loadAuthorizedScoreboardContext(mapId: string) {
if (!z.uuid().safeParse(mapId).success) throw new AppError(ErrorCode.VALIDATION_FAILED, "地图记录无效");
const [match] = await db.select({ id: matches.id, seasonId: matches.seasonId,
  entryAId: matches.entryAId, entryBId: matches.entryBId, stage: matches.stage,
}).from(matchMaps).innerJoin(matches, eq(matches.id, matchMaps.matchId)).where(eq(matchMaps.id, mapId)).limit(1);
if (!match) throw new AppError(ErrorCode.NOT_FOUND, "地图或比赛记录不存在");
assertCompetitionMatch(match);
const session = await requireSeasonAdmin(match.seasonId);
return { ...match, actorUserId: session.userId };
}

/** COMMIT is already confirmed; cache failure must not turn it into an apparent rejected write. */
function refreshScoreboardAfterCommit(): boolean {
  try {
    updatePublicStatsTag("scoreboard");
    revalidatePath("/[seasonSlug]/matches/[matchId]", "page");
    return false;
  } catch (error) {
    captureException("action.scoreboard_refresh_failure", error, { scope: "action", operation: "scoreboard.refresh" });
    return true;
  }
}

/** Explicit recovery of invalidation only; never replays the scoreboard mutation. */
export async function retryPlayerStatsRefresh(mapId: string): Promise<ActionResult<void>> {
  try {
    await loadAuthorizedScoreboardContext(mapId);
    updatePublicStatsTag("scoreboard");
    revalidatePath("/[seasonSlug]/matches/[matchId]", "page");
    return ok(undefined);
  } catch (error) { return actionError("retryPlayerStatsRefresh", error); }
}

/**
 * 从截图 base64 提取记分板数据（不写库），返回草稿供管理员确认。
 * 同时返回赛季中所有已匹配玩家列表供下拉选择。
 */
export async function extractStatsFromScreenshot(
  input: {
    mapId: string;
    base64Image: string;
    mimeType: "image/jpeg" | "image/png" | "image/webp";
  },
) {
  const { mapId, base64Image, mimeType } = input;
  try {
    const match = await loadAuthorizedScoreboardContext(mapId);
    const [seasonPlayers, ocrResult, snapshot] = await Promise.all([
      (async () => loadScoreboardPlayers(db, match.id, [match.entryAId, match.entryBId]))(),
      extractScoreboardFromBase64(base64Image, mimeType),
      loadOperatorScoreboardSnapshot(db, mapId),
    ]);

    const nameToUserId = new Map<string, string>();
    for (const p of seasonPlayers) {
      if (p.perfectName) {
        nameToUserId.set(p.perfectName.toLowerCase(), p.userId);
      }
    }

    const drafts: PlayerStatsDraft[] = ocrResult.players.map((row) => {
      const name = row.perfectName as string;
      return {
        ...row,
        perfectName: name,
        userId: nameToUserId.get(name.toLowerCase()) ?? null,
      };
    });

    const playerOptions: PlayerOption[] = seasonPlayers.map((p) => ({
      userId: p.userId,
      perfectName: p.perfectName ?? "(未填写昵称)",
    }));

    return ok({ drafts, playerOptions, snapshot: { ...snapshot, actorScope: match.actorUserId } });
  } catch (e) {
    if (e instanceof OCRFailure) {
      captureException("provider.siliconflow.ocr_failure", e, {
        scope: "provider",
        operation: "ocr.extract",
        provider: "siliconflow",
        requestId: e.requestId,
        errorClass: e.kind === "image" ? "expected" : "dependency",
        errorCode: `ocr.${e.kind}`,
        retryable: e.retryable,
        safeContext: {
          ...e.responseSummary,
          phase: e.phase, reason: e.reason, httpStatus: e.httpStatus,
          // Aligned, bounded arrays preserve each sanitized cause through the
          // existing observability allowlist, exclusively in server diagnostics.
          errorCodes: e.diagnostics.length ? e.diagnostics.map(item => item.code) : e.errorChain,
          errorName: e.diagnostics.map(item => item.name),
          errorMessage: e.diagnostics.map(item => item.message),
        },
      });
      return fail(presentOCRFailure(e));
    }
    if (e instanceof AppError) {
      return fail({ code: e.code, message: e.code === ErrorCode.INTERNAL_ERROR ? ERROR_MESSAGES.INTERNAL_ERROR : e.presentation?.message ?? e.message });
    }
    captureException("action.unexpected_error", e, {
      scope: "action",
      operation: "extractStatsFromScreenshot",
      errorClass: "application",
    });
    return fail({ code: ErrorCode.INTERNAL_ERROR, message: ERROR_MESSAGES.INTERNAL_ERROR });
  }
}

/**
 * 保存管理员确认后的 OCR 数据。OCR 只拥有 ratingPro / rws / we；已有
 * DAK 投影的 KDA、ADR、KAST、开局与补枪等字段必须保留，避免旧的删写
 * 路径把 Demo 事实一并抹掉。
 */
export async function savePlayerStats(
  mapId: string,
  input: { rows: PlayerStatsDraft[] } & ScoreboardCommand
) {
  try {
    const parsed = scoreboardCommandSchema.extend({ rows: z.array(playerRowSchema.extend({ perfectName: z.string().trim().min(1).max(128), userId: z.uuid().nullable() })).max(20) }).safeParse(input);
    if (!parsed.success) throw new AppError(ErrorCode.VALIDATION_FAILED, "选手数据格式不合法");
    const stats = parsed.data.rows;
    if (stats.some(row => row.userId === null)) throw new AppError(ErrorCode.VALIDATION_FAILED, "每行选手都必须匹配本场出场阵容");
    const userIds = stats.map(row => row.userId!);
    if (new Set(userIds).size !== userIds.length) throw new AppError(ErrorCode.VALIDATION_FAILED, "同一张地图不能重复关联同一选手");
    const map = await db.query.matchMaps.findFirst({
      where: eq(matchMaps.id, mapId),
    });
    if (!map) throw new AppError(ErrorCode.NOT_FOUND, "地图记录不存在");

    const match = await db.query.matches.findFirst({
      where: eq(matches.id, map.matchId),
    });
    if (!match) throw new AppError(ErrorCode.NOT_FOUND, "比赛记录不存在");
    assertCompetitionMatch(match);
    const session = await requireSeasonAdmin(match.seasonId);
    const actor = auditActorId(session);
    assertScoreboardActor(parsed.data.expectedActor, actor);

    const violations: string[] = [];
    for (const s of stats) {
      const name = s.perfectName as string;
      for (const [key, val] of Object.entries(s)) {
        if (typeof val === "number" && isStatOutOfRange(key, val)) {
          violations.push(`${name}.${key}=${val}`);
        }
      }
    }
    if (violations.length > 0) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        `数据超出合法范围：${violations.slice(0, 5).join("，")}${violations.length > 5 ? `…（共 ${violations.length} 处）` : ""}`,
      );
    }

    const payloadDigest = scoreboardPayloadDigest(mapId, "save", parsed.data, stats);
    const outcome = await db.transaction(async (tx) => {
      const currentMatch = await lockMatchForEvidenceInTx(tx, map.matchId);
      assertCompetitionMatch(currentMatch);
      if (currentMatch.seasonId !== match.seasonId) throw new AppError(ErrorCode.VALIDATION_FAILED, "比赛所属赛事已变化，请重新读取后再操作。");
      const [currentMap] = await tx.select({ matchId: matchMaps.matchId, scoreA: matchMaps.scoreA, scoreB: matchMaps.scoreB, completedAt: matchMaps.completedAt }).from(matchMaps).where(eq(matchMaps.id, mapId)).for("update");
      if (!currentMap) throw new AppError(ErrorCode.NOT_FOUND, "地图或比赛记录不存在");
      if (currentMap.matchId !== currentMatch.id) throw new AppError(ErrorCode.VALIDATION_FAILED, "地图所属比赛已变化，请重新读取后再操作。");
      const priorReceipt = await findScoreboardReceipt(tx, actor, parsed.data.operationId);
      if (priorReceipt) {
        assertScoreboardReplay(priorReceipt, mapId, "save", payloadDigest);
        return { receipt: presentScoreboardReceipt(priorReceipt), replayed: true };
      }
      if (!canConfirmMapScoreboard(currentMap)) throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "只有已结束的地图可以确认选手数据。");
      const allowed = await loadScoreboardPlayers(tx, currentMatch.id, [currentMatch.entryAId, currentMatch.entryBId]);
      const userPerfectNames = new Map(allowed.map(row => [row.userId, row.perfectName]));
      if (userIds.some(id => !userPerfectNames.has(id))) throw new AppError(ErrorCode.VALIDATION_FAILED, "选手不属于本场出场阵容");
      const normalizedStats = stats.map(row => ({ ...row, perfectName: (row.userId && userPerfectNames.get(row.userId)) || row.perfectName }));
      const existing = await tx.select(scoreboardVersionColumns).from(matchPlayerStats).where(eq(matchPlayerStats.mapId, mapId)).for("update");
      assertScoreboardVersion(scoreboardVersion(mapId, existing), parsed.data.expectedVersion);
      const existingByUser = new Map(existing.filter((row) => row.userId != null).map((row) => [row.userId!, row]));
      const existingByName = new Map(existing.map((row) => [row.perfectName, row]));
      const matchedIds = new Set<string>();
      const seenNames = new Set<string>();

      for (const s of normalizedStats) {
        if (seenNames.has(s.perfectName)) throw new AppError(ErrorCode.VALIDATION_FAILED, `同一张截图中出现重复选手：${s.perfectName}`);
        seenNames.add(s.perfectName);
        const named = existingByName.get(s.perfectName);
        if (s.userId && named?.userId && named.userId !== s.userId) {
          throw new AppError(ErrorCode.VALIDATION_FAILED, `选手昵称与用户身份冲突：${s.perfectName}`);
        }
        const prior = (s.userId ? existingByUser.get(s.userId) : undefined)
          ?? (named && (!s.userId || named.userId == null || named.userId === s.userId) ? named : undefined);
        const userId = s.userId ?? prior?.userId ?? null;
        if (userId && !userPerfectNames.has(userId)) throw new AppError(ErrorCode.VALIDATION_FAILED, "选手不属于本场出场阵容");
        if (!prior?.dakImportId && !isScoreboardRoundConsistent(s, currentMap.scoreA! + currentMap.scoreB!)) throw new AppError(ErrorCode.VALIDATION_FAILED, "选手数据与本图正式回合数不一致，请核对地图与截图。");
        const now = new Date();
        if (prior) {
          matchedIds.add(prior.id);
          const enrichment = applyOcrScoreboardEnrichment(prior, s);
          if (prior.dakImportId) {
            // DAK owns identity, gameplay and confirmation provenance. OCR may
            // enrich only the three operator scoreboard fields.
            await tx.update(matchPlayerStats).set(enrichment).where(eq(matchPlayerStats.id, prior.id));
          } else {
            await tx.update(matchPlayerStats).set({
              perfectName: s.perfectName,
              userId,
              ...enrichment,
              verifiedByAdmin: actor,
              verifiedAt: now,
              kills: s.kills,
              deaths: s.deaths,
              assists: s.assists,
              hsPercent: s.hsPercent,
              firstKills: s.firstKills,
              multiKills: s.multiKills,
              clutches: s.clutches,
              adr: s.adr,
            }).where(eq(matchPlayerStats.id, prior.id));
          }
          continue;
        }
        await tx.insert(matchPlayerStats).values({
          matchId: map.matchId,
          mapId,
          perfectName: s.perfectName,
          userId,
          kills: s.kills,
          deaths: s.deaths,
          assists: s.assists,
          hsPercent: s.hsPercent,
          firstKills: s.firstKills,
          multiKills: s.multiKills,
          clutches: s.clutches,
          adr: s.adr,
          rws: s.rws,
          ratingPro: s.ratingPro,
          we: s.we,
          verifiedByAdmin: actor,
          verifiedAt: now,
        });
      }

      // Preserve every DAK-owned row. Only legacy OCR-only rows absent from
      // the replacement screenshot retain the old delete-and-replace behavior.
      for (const row of existing) {
        if (!row.dakImportId && !matchedIds.has(row.id)) await tx.delete(matchPlayerStats).where(eq(matchPlayerStats.id, row.id));
      }

      await writeAuditInTx(tx, {
        seasonId: match.seasonId,
        action: "match.save_player_stats",
        actorId: actor,
        targetId: mapId, meta: { playerCount: stats.length, matchId: map.matchId, operationId: parsed.data.operationId },
      });
      const snapshot = await loadOperatorScoreboardSnapshot(tx, mapId);
      const receipt = await commitScoreboardReceipt(tx, { actorUserId: actor, mapId, operation: "save", command: parsed.data,
        payloadDigest, resultVersion: snapshot.version, resultCount: snapshot.rows.length });
      return { receipt, replayed: false };
    });

    return ok({ saved: stats.length, ...outcome, refreshPending: refreshScoreboardAfterCommit() });
  } catch (e) {
    return scoreboardFailure("savePlayerStats", e);
  }
}

/**
 * 查询某张地图已保存的计分板数据。只服务后台编辑器：先按本场所属赛季授权，
 * 再经 server-only read model 返回 sanitized DTO，不下发 DAK lineage 与审核字段。
 */
export async function getPlayerStatsByMap(mapId: string): Promise<ActionResult<OperatorScoreboardRow[]>> {
  try {
    await loadAuthorizedScoreboardContext(mapId);
    return ok(await loadOperatorScoreboard(db, mapId));
  } catch (error) {
    return actionError("getPlayerStatsByMap", error);
  }
}

/** Freshly authorized options; failures cannot masquerade as an empty roster. */
export async function getMatchPlayerOptions(mapId: string): Promise<ActionResult<PlayerOption[]>> {
  try {
    const match = await loadAuthorizedScoreboardContext(mapId);
    const seasonPlayers = await loadScoreboardPlayers(db, match.id, [match.entryAId, match.entryBId]);
    return ok(seasonPlayers.map(p => ({ userId: p.userId, perfectName: p.perfectName ?? "(未填写昵称)" })));
  } catch (error) {
    return actionError("getMatchPlayerOptions", error);
  }
}

export async function getOperatorScoreboardSnapshot(mapId: string): Promise<ActionResult<AuthorizedScoreboardSnapshot>> {
  try {
    const match = await loadAuthorizedScoreboardContext(mapId);
    return ok({ ...await loadOperatorScoreboardSnapshot(db, mapId), actorScope: match.actorUserId });
  } catch (error) { return actionError("getOperatorScoreboardSnapshot", error); }
}

export async function getScoreboardEditorState(mapId: string) {
  try {
    const match = await loadAuthorizedScoreboardContext(mapId);
    const [snapshot, players] = await Promise.all([
      loadOperatorScoreboardSnapshot(db, mapId),
      loadScoreboardPlayers(db, match.id, [match.entryAId, match.entryBId]),
    ]);
    return ok({ snapshot: { ...snapshot, actorScope: match.actorUserId }, playerOptions: players.map(player => ({ userId: player.userId, perfectName: player.perfectName ?? "(未填写昵称)" })) });
  } catch (error) { return actionError("getScoreboardEditorState", error); }
}

export async function getScoreboardOperationReceipt(mapId: string, input: ScoreboardCommand & { operation: ScoreboardOperation }): Promise<ActionResult<ScoreboardReceiptStatus>> {
  try {
    const parsed = scoreboardCommandSchema.extend({ operation: z.enum(["save", "clear"]) }).safeParse(input);
    if (!parsed.success) throw new AppError(ErrorCode.VALIDATION_FAILED, "原操作编号或内容无效");
    const match = await loadAuthorizedScoreboardContext(mapId);
    assertScoreboardActor(parsed.data.expectedActor, match.actorUserId);
    const receipt = await findScoreboardReceipt(db, match.actorUserId, parsed.data.operationId);
    if (!receipt || receipt.mapId !== mapId) return ok({ status: "unconfirmed" });
    if (receipt.operation !== parsed.data.operation || receipt.baseVersion !== parsed.data.expectedVersion) {
      throw new ScoreboardConflict("原操作编号与操作上下文不一致，请核对提交记录。");
    }
    // Sequential read: never compare the receipt to an older parallel snapshot.
    const snapshot = await loadOperatorScoreboardSnapshot(db, mapId);
    return ok({ status: "committed", receipt: presentScoreboardReceipt(receipt), snapshot: { ...snapshot, actorScope: match.actorUserId }, superseded: receipt.resultVersion !== snapshot.version });
  } catch (error) { return scoreboardFailure("getScoreboardOperationReceipt", error); }
}

export async function castMatchMvpVote(
  matchId: string,
  playerUserId: string,
) {
  try {
    const session = await requireAuth();
    if (!session?.userId) {
      return fail({ code: ErrorCode.UNAUTHORIZED, message: "请先登录" });
    }

    // 注册 24h 后才能投票
    const [userRow] = await db
      .select({ createdAt: users.createdAt })
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1);

    if (!userRow?.createdAt) {
      return fail({ code: ErrorCode.UNAUTHORIZED, message: "账号状态异常，请重新登录" });
    }
    const hoursSinceRegistration = (Date.now() - userRow.createdAt.getTime()) / 3_600_000;
    if (hoursSinceRegistration < 24) {
      return fail({
        code: ErrorCode.MATCH_VOTE_TOO_EARLY,
        message: ERROR_MESSAGES.MATCH_VOTE_TOO_EARLY,
      });
    }

    const voteResult = await db.transaction(async (tx) => {
      // Serialize the acceptance window with scheduled settlement. The shared
      // match lock allows concurrent voters but excludes winner finalization.
      const [match] = await tx.select({
        id: matches.id,
        status: matches.status,
        completedAt: matches.completedAt,
        mvpWinnerUserId: matches.mvpWinnerUserId,
      }).from(matches).where(eq(matches.id, matchId)).for("share");
      if (!match) throw new AppError(ErrorCode.MATCH_NOT_FOUND, ERROR_MESSAGES.MATCH_NOT_FOUND);
      if (match.status !== "finished") {
        return fail({ code: ErrorCode.MATCH_INVALID_TRANSITION, message: "比赛尚未结束" });
      }

      // 比赛结束 24 小时后停止投票
      if (match.mvpWinnerUserId) {
        return fail({ code: ErrorCode.MATCH_INVALID_TRANSITION, message: "MVP 投票已截止" });
      }
      if (match.completedAt) {
        const deadline = match.completedAt.getTime() + MVP_DEADLINE_MS;
        if (Date.now() >= deadline) {
          return fail({ code: ErrorCode.MATCH_INVALID_TRANSITION, message: "MVP 投票已截止" });
        }
      }

      const confirmedCandidates = await tx
        .select({ userId: users.id, playerName: users.perfectName })
        .from(matchRosters)
        .innerJoin(matchRosterPlayers, eq(matchRosterPlayers.rosterId, matchRosters.id))
        .innerJoin(eventRosterMembers, eq(eventRosterMembers.id, matchRosterPlayers.eventRosterMemberId))
        .innerJoin(users, eq(users.id, eventRosterMembers.userId))
        .where(and(
          eq(matchRosters.matchId, matchId),
          eq(matchRosters.status, "confirmed"),
          eq(matchRosterPlayers.isStarter, true),
        ));
      // Confirmed match roster is the sole normal-path candidate owner. Older
      // Rivals records predate it, so only then derive compatible candidates
      // from verified match stats.
      const candidates = confirmedCandidates.length > 0
        ? confirmedCandidates
        : await tx
            .select({ userId: users.id, playerName: users.perfectName })
            .from(matchPlayerStats)
            .innerJoin(users, eq(users.id, matchPlayerStats.userId))
            .where(and(
              eq(matchPlayerStats.matchId, matchId),
              isNotNull(matchPlayerStats.userId),
              isNotNull(matchPlayerStats.verifiedAt),
            ));
      const selected = candidates.find((candidate) => candidate.userId === playerUserId);
      if (!selected) {
        return fail({ code: ErrorCode.VALIDATION_FAILED, message: "该选手不在本场可投票名单中" });
      }

      await tx.insert(matchMvpVotes).values({
        matchId,
        playerUserId: selected.userId,
        playerName: selected.playerName ?? "未填写昵称",
        voterUserId: session.userId,
      });

      return ok(undefined);
    });
    if (!voteResult.success) return voteResult;

    revalidatePath("/[seasonSlug]/matches/[matchId]", "page");
    return ok(undefined);
  } catch (e) {
    if (e instanceof AppError) return fail({ code: e.code, message: e.code === ErrorCode.INTERNAL_ERROR ? ERROR_MESSAGES.INTERNAL_ERROR : e.presentation?.message ?? e.message });
    if (isPgUniqueViolation(e, "match_mvp_votes_match_id_voter_user_id_unique")) {
      return fail({ code: ErrorCode.VOTE_DUPLICATE, message: "您已为本场比赛投过 MVP 票" });
    }
    captureException("action.unexpected_error", e, {
      scope: "action",
      operation: "castMatchMvpVote",
      errorClass: "application",
    });
    return fail({ code: ErrorCode.INTERNAL_ERROR, message: ERROR_MESSAGES.INTERNAL_ERROR });
  }
}

/**
 * 清除管理员记分板输入；保留 DAK gameplay projection 与确认事实。
 */
export async function deletePlayerStatsByMap(mapId: string, command: ScoreboardCommand) {
  try {
    const parsed = scoreboardCommandSchema.safeParse(command);
    if (!parsed.success) throw new AppError(ErrorCode.VALIDATION_FAILED, "计分板操作编号或版本无效");
    const map = await db.query.matchMaps.findFirst({ where: eq(matchMaps.id, mapId) });
    if (!map) throw new AppError(ErrorCode.NOT_FOUND, "地图记录不存在");
    const match = await db.query.matches.findFirst({ where: eq(matches.id, map.matchId) });
    if (!match) throw new AppError(ErrorCode.NOT_FOUND, "比赛记录不存在");
    assertCompetitionMatch(match);
    const session = await requireSeasonAdmin(match.seasonId);

    const actor = auditActorId(session);
    assertScoreboardActor(parsed.data.expectedActor, actor);
    const payloadDigest = scoreboardPayloadDigest(mapId, "clear", parsed.data);
    const outcome = await db.transaction(async (tx) => {
      const currentMatch = await lockMatchForEvidenceInTx(tx, map.matchId);
      assertCompetitionMatch(currentMatch);
      if (currentMatch.seasonId !== match.seasonId) throw new AppError(ErrorCode.VALIDATION_FAILED, "比赛所属赛事已变化，请重新读取后再操作。");
      const [currentMap] = await tx.select({ id: matchMaps.id, matchId: matchMaps.matchId }).from(matchMaps).where(eq(matchMaps.id, mapId)).for("update");
      if (!currentMap) throw new AppError(ErrorCode.NOT_FOUND, "地图或比赛记录不存在");
      if (currentMap.matchId !== currentMatch.id) throw new AppError(ErrorCode.VALIDATION_FAILED, "地图所属比赛已变化，请重新读取后再操作。");
      const priorReceipt = await findScoreboardReceipt(tx, actor, parsed.data.operationId);
      if (priorReceipt) {
        assertScoreboardReplay(priorReceipt, mapId, "clear", payloadDigest);
        return { receipt: presentScoreboardReceipt(priorReceipt), replayed: true };
      }
      const existing = await tx.select(scoreboardVersionColumns).from(matchPlayerStats).where(eq(matchPlayerStats.mapId, mapId)).for("update");
      assertScoreboardVersion(scoreboardVersion(mapId, existing), parsed.data.expectedVersion);
      await clearOperatorScoreboardInTx(tx, mapId);
      await writeAuditInTx(tx, {
        seasonId: match.seasonId,
        action: "match.clear_operator_scoreboard",
        actorId: auditActorId(session),
        targetId: mapId, meta: { mapId, operationId: parsed.data.operationId },
      });
      const snapshot = await loadOperatorScoreboardSnapshot(tx, mapId);
      const receipt = await commitScoreboardReceipt(tx, { actorUserId: actor, mapId, operation: "clear", command: parsed.data,
        payloadDigest, resultVersion: snapshot.version, resultCount: snapshot.rows.length });
      return { receipt, replayed: false };
    });

    return ok({ ...outcome, refreshPending: refreshScoreboardAfterCommit() });
  } catch (e) {
    return scoreboardFailure("deletePlayerStatsByMap", e);
  }
}

export async function getMatchMvpResults(matchId: string) {
  return readMatchMvpResults(matchId);
}
