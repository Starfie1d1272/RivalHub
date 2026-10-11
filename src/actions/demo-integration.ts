"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { matchDemoImports, matches, seasons, userGameplaySteamIds } from "@/db/schema";
import { classifyError } from "@/lib/observability/errors";
import { ensureRequestId } from "@/lib/observability/context";
import { captureException } from "@/lib/observability/server";
import { actionError, failValidation } from "@/lib/action-utils";
import { auditActorId, requireSeasonAdmin } from "@/lib/auth/session";
import { AppError, ErrorCode } from "@/lib/errors";
import {
  confirmStoredDemoParticipantIdentityInTx,
  rejectStoredDemoImportInTx,
  retireSeasonGameplaySteamIdentityInTx,
} from "@/lib/demo-integration/review";
import {
  revalidateNeedsAttentionImportsForSteam64,
  revalidateSeasonNeedsAttentionImports,
  revalidateStoredDemoImportInTx,
} from "@/lib/demo-integration/revalidation";
import { revalidateMatchPaths } from "@/lib/revalidation";
import { ok, type ActionResult } from "@/types/action";

// Preserve the canonical boundary's cause projection and request id while the
// Demo owner supplies recovery tied to its existing pending-only controls.
function demoRecheckError(scope: string, error: unknown, phase: string): ActionResult<never> {
  const result = actionError(scope, error, phase);
  if (result.success || result.error.code !== ErrorCode.INTERNAL_ERROR) return result;
  const recovery = phase === "revalidation"
    ? "检查结果已保存，但页面刷新失败。请先刷新核对身份与 Demo 状态，不要重新上传或重复确认；如无法查看，请联系管理员。"
    : classifyError(error).retryable
      ? "未能完成 Demo 检查。请先刷新核对状态，稍后使用“按当前资料重新检查”或“重新检查本赛事全部待处理 Demo”；不要重新上传同一份数据。如仍失败，请联系管理员。"
      : "未能完成 Demo 检查。请先刷新核对状态，并联系管理员排查系统故障；恢复后使用“按当前资料重新检查”或“重新检查本赛事全部待处理 Demo”，不要重新上传同一份数据。";
  return { ...result, error: { ...result.error, message: `${recovery}排查编号：${result.error.requestId}` } };
}

const uuid = z.guid();
const steam64 = z.string().regex(/^\d{17}$/, "Steam64 ID 格式无效。");

async function loadImportContext(importId: string) {
  const row = await db.query.matchDemoImports.findFirst({ where: eq(matchDemoImports.id, importId), columns: { id: true, seasonId: true, matchId: true } });
  if (!row) throw new AppError(ErrorCode.NOT_FOUND, "待处理的 Demo 数据不存在。");
  const season = await db.query.seasons.findFirst({ where: eq(seasons.id, row.seasonId), columns: { id: true, slug: true } });
  if (!season) throw new AppError(ErrorCode.NOT_FOUND, "Demo 对应的赛季不存在。");
  return { row, season };
}

type ConfirmStoredDemoParticipantIdentityActionData = Awaited<ReturnType<typeof confirmStoredDemoParticipantIdentityInTx>> & {
  relatedRechecks: {
    attempted: number;
    confirmed: number;
    remaining: number;
    failed: number;
    requestId?: string;
  };
};

export async function confirmStoredDemoParticipantIdentity(
  input: unknown,
): Promise<ActionResult<ConfirmStoredDemoParticipantIdentityActionData>> {
  const parsed = z.object({ importId: uuid, eventRosterMemberId: uuid, observedSteam64: steam64 }).safeParse(input);
  if (!parsed.success) return failValidation("比赛 Steam 身份确认参数无效。");
  try {
    const { row, season } = await loadImportContext(parsed.data.importId);
    const admin = await requireSeasonAdmin(row.seasonId);
    const actorId = auditActorId(admin);
    const result = await db.transaction((tx) => confirmStoredDemoParticipantIdentityInTx(tx, {
      ...parsed.data,
      actorId,
    }));
    let relatedRechecks;
    try {
      relatedRechecks = await revalidateNeedsAttentionImportsForSteam64({
        seasonId: row.seasonId,
        steam64: parsed.data.observedSteam64,
        actorId,
        excludeImportId: row.id,
      });
    } catch (error) {
      const requestId = ensureRequestId();
      captureException("demo.recheck.failure", error, {
        scope: "demo", operation: "recheck.related", requestId, safeContext: { phase: "candidate_selection" },
      });
      relatedRechecks = { attempted: 0, confirmed: 0, remaining: 0, failed: 1, affectedMatchIds: [], requestId };
    }
    revalidateMatchPaths(season.slug, row.matchId);
    for (const matchId of relatedRechecks.affectedMatchIds) revalidateMatchPaths(season.slug, matchId);
    return ok({
      ...result,
      relatedRechecks: {
        attempted: relatedRechecks.attempted,
        confirmed: relatedRechecks.confirmed,
        remaining: relatedRechecks.remaining,
        failed: relatedRechecks.failed,
        ...(relatedRechecks.requestId ? { requestId: relatedRechecks.requestId } : {}),
      },
    });
  } catch (error) {
    return actionError("confirmStoredDemoParticipantIdentity", error);
  }
}


export async function recheckSeasonStoredDemoImports(
  input: unknown,
): Promise<ActionResult<Awaited<ReturnType<typeof revalidateSeasonNeedsAttentionImports>>>> {
  const parsed = z.object({ importId: uuid }).safeParse(input);
  if (!parsed.success) return failValidation("批量重新检查 Demo 数据的参数无效。");
  let phase = "read";
  try {
    const { row, season } = await loadImportContext(parsed.data.importId);
    const admin = await requireSeasonAdmin(row.seasonId);
    phase = "recheck";
    const result = await revalidateSeasonNeedsAttentionImports({
      seasonId: row.seasonId,
      actorId: auditActorId(admin),
    });
    phase = "revalidation";
    for (const matchId of result.affectedMatchIds) revalidateMatchPaths(season.slug, matchId);
    return ok(result);
  } catch (error) {
    return demoRecheckError("recheckSeasonStoredDemoImports", error, phase);
  }
}


export async function recheckStoredDemoImport(
  input: unknown,
): Promise<ActionResult<Awaited<ReturnType<typeof revalidateStoredDemoImportInTx>>>> {
  const parsed = z.object({ importId: uuid }).safeParse(input);
  if (!parsed.success) return failValidation("重新检查 Demo 数据的参数无效。");
  let phase = "read";
  try {
    const { row, season } = await loadImportContext(parsed.data.importId);
    const admin = await requireSeasonAdmin(row.seasonId);
    const actorId = auditActorId(admin);
    phase = "recheck";
    const result = await db.transaction((tx) => revalidateStoredDemoImportInTx(tx, {
      importId: row.id,
      actorId,
      verifiedBy: `admin:${actorId}`,
    }));
    phase = "revalidation";
    revalidateMatchPaths(season.slug, row.matchId);
    return ok(result);
  } catch (error) {
    return demoRecheckError("recheckStoredDemoImport", error, phase);
  }
}


export async function rejectStoredDemoImport(
  input: unknown,
): Promise<ActionResult<Awaited<ReturnType<typeof rejectStoredDemoImportInTx>>>> {
  const parsed = z.object({ importId: uuid }).safeParse(input);
  if (!parsed.success) return failValidation("拒绝 Demo 数据的参数无效。");
  try {
    const { row, season } = await loadImportContext(parsed.data.importId);
    const admin = await requireSeasonAdmin(row.seasonId);
    const result = await db.transaction((tx) => rejectStoredDemoImportInTx(tx, {
      importId: parsed.data.importId,
      actorId: auditActorId(admin),
    }));
    revalidateMatchPaths(season.slug, row.matchId);
    return ok(result);
  } catch (error) {
    return actionError("rejectStoredDemoImport", error);
  }
}

export async function retireGameplaySteamIdentity(
  input: unknown,
): Promise<ActionResult<Awaited<ReturnType<typeof retireSeasonGameplaySteamIdentityInTx>>>> {
  const parsed = z.object({ identityId: uuid, reason: z.string().trim().min(2).max(500) }).safeParse(input);
  if (!parsed.success) return failValidation("撤销比赛 Steam 身份的参数无效。");
  try {
    const identity = await db.query.userGameplaySteamIds.findFirst({ where: eq(userGameplaySteamIds.id, parsed.data.identityId) });
    if (!identity?.sourceImportId) return failValidation("只能撤销由比赛确认产生的 Steam 身份。");
    const source = await db.query.matchDemoImports.findFirst({ where: eq(matchDemoImports.id, identity.sourceImportId), columns: { seasonId: true, matchId: true } });
    if (!source) return failValidation("该 Steam 身份的来源 Demo 不存在。");
    const season = await db.query.seasons.findFirst({ where: eq(seasons.id, source.seasonId), columns: { id: true, slug: true } });
    if (!season) return failValidation("该 Steam 身份的来源赛季不存在。");
    const admin = await requireSeasonAdmin(season.id);
    const result = await db.transaction((tx) => retireSeasonGameplaySteamIdentityInTx(tx, {
      ...parsed.data,
      seasonId: season.id,
      actorId: auditActorId(admin),
    }));
    const sourceMatch = await db.query.matches.findFirst({ where: eq(matches.id, source.matchId), columns: { id: true } });
    if (sourceMatch) revalidateMatchPaths(season.slug, sourceMatch.id);
    return ok(result);
  } catch (error) {
    return actionError("retireGameplaySteamIdentity", error);
  }
}
