"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { matchDemoImports, matches, seasons, userGameplaySteamIds } from "@/db/schema";
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
  revalidateStoredDemoImportInTx,
} from "@/lib/demo-integration/revalidation";
import { revalidateMatchPaths } from "@/lib/revalidation";
import { ok, type ActionResult } from "@/types/action";

const uuid = z.guid();
const steam64 = z.string().regex(/^\d{17}$/, "Steam64 ID 格式无效。");

async function loadImportContext(importId: string) {
  const row = await db.query.matchDemoImports.findFirst({ where: eq(matchDemoImports.id, importId) });
  if (!row) throw new AppError(ErrorCode.NOT_FOUND, "待处理的 Demo 数据不存在。");
  const season = await db.query.seasons.findFirst({ where: eq(seasons.id, row.seasonId), columns: { id: true, slug: true } });
  if (!season) throw new AppError(ErrorCode.NOT_FOUND, "Demo 对应的赛季不存在。");
  return { row, season };
}

export async function confirmStoredDemoParticipantIdentity(
  input: unknown,
): Promise<ActionResult<Awaited<ReturnType<typeof confirmStoredDemoParticipantIdentityInTx>>>> {
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
    const relatedRechecks = await revalidateNeedsAttentionImportsForSteam64({
      seasonId: row.seasonId,
      steam64: parsed.data.observedSteam64,
      actorId,
      excludeImportId: row.id,
    });
    revalidateMatchPaths(season.slug, row.matchId);
    for (const matchId of relatedRechecks.affectedMatchIds) revalidateMatchPaths(season.slug, matchId);
    return ok({
      ...result,
      relatedRechecks: {
        attempted: relatedRechecks.attempted,
        confirmed: relatedRechecks.confirmed,
        remaining: relatedRechecks.remaining,
        failed: relatedRechecks.failed,
      },
    });
  } catch (error) {
    return actionError("confirmStoredDemoParticipantIdentity", error);
  }
}


export async function recheckStoredDemoImport(
  input: unknown,
): Promise<ActionResult<Awaited<ReturnType<typeof revalidateStoredDemoImportInTx>>>> {
  const parsed = z.object({ importId: uuid }).safeParse(input);
  if (!parsed.success) return failValidation("重新检查 Demo 数据的参数无效。");
  try {
    const { row, season } = await loadImportContext(parsed.data.importId);
    const admin = await requireSeasonAdmin(row.seasonId);
    const actorId = auditActorId(admin);
    const result = await db.transaction((tx) => revalidateStoredDemoImportInTx(tx, {
      importId: row.id,
      actorId,
      verifiedBy: `admin:${actorId}`,
    }));
    revalidateMatchPaths(season.slug, row.matchId);
    return ok(result);
  } catch (error) {
    return actionError("recheckStoredDemoImport", error);
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
    const source = await db.query.matchDemoImports.findFirst({ where: eq(matchDemoImports.id, identity.sourceImportId) });
    if (!source) return failValidation("该 Steam 身份的来源 Demo 不存在。");
    const season = await db.query.seasons.findFirst({ where: eq(seasons.id, source.seasonId), columns: { id: true, slug: true } });
    if (!season) return failValidation("该 Steam 身份的来源赛季不存在。");
    const admin = await requireSeasonAdmin(season.id);
    const actorId = auditActorId(admin);
    const result = await db.transaction((tx) => retireSeasonGameplaySteamIdentityInTx(tx, {
      ...parsed.data,
      seasonId: season.id,
      actorId,
    }));
    const relatedRechecks = typeof identity.steam64 === "string"
      ? await revalidateNeedsAttentionImportsForSteam64({
          seasonId: season.id,
          steam64: identity.steam64,
          actorId,
        })
      : null;
    const sourceMatch = await db.query.matches.findFirst({ where: eq(matches.id, source.matchId), columns: { id: true } });
    if (sourceMatch) revalidateMatchPaths(season.slug, sourceMatch.id);
    for (const matchId of relatedRechecks?.affectedMatchIds ?? []) revalidateMatchPaths(season.slug, matchId);
    return ok(result);
  } catch (error) {
    return actionError("retireGameplaySteamIdentity", error);
  }
}
