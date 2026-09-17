"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { matchDemoImports, seasons } from "@/db/schema";
import { actionError, failValidation } from "@/lib/action-utils";
import { auditActorId, requireSeasonAdmin, requireSuperAdmin } from "@/lib/auth/session";
import { AppError, ErrorCode } from "@/lib/errors";
import {
  confirmGameplaySteamIdentityInTx,
  rejectStoredDemoImportInTx,
  retireGameplaySteamIdentityInTx,
} from "@/lib/demo-integration/review";
import { revalidateMatchPaths } from "@/lib/revalidation";
import { ok, type ActionResult } from "@/types/action";

const uuid = z.guid();
const steam64 = z.string().regex(/^\d{17}$/, "Steam64 ID 格式无效。");

async function loadImportContext(importId: string) {
  const row = await db.query.matchDemoImports.findFirst({ where: eq(matchDemoImports.id, importId) });
  if (!row) throw new AppError(ErrorCode.NOT_FOUND, "待处理的 Demo 数据不存在。");
  const season = await db.query.seasons.findFirst({ where: eq(seasons.id, row.seasonId), columns: { slug: true } });
  if (!season) throw new AppError(ErrorCode.NOT_FOUND, "Demo 对应的赛季不存在。");
  return { row, season };
}

export async function confirmGameplaySteamIdentity(input: unknown): Promise<ActionResult<Awaited<ReturnType<typeof confirmGameplaySteamIdentityInTx>>>> {
  const parsed = z.object({ importId: uuid, eventRosterMemberId: uuid, observedSteam64: steam64 }).safeParse(input);
  if (!parsed.success) return failValidation("比赛 Steam 身份确认参数无效。");
  try {
    const { row, season } = await loadImportContext(parsed.data.importId);
    const admin = await requireSeasonAdmin(row.seasonId);
    const result = await db.transaction((tx) => confirmGameplaySteamIdentityInTx(tx, {
      ...parsed.data,
      actorId: auditActorId(admin),
    }));
    revalidateMatchPaths(season.slug, row.matchId);
    return ok(result);
  } catch (error) {
    return actionError("confirmGameplaySteamIdentity", error);
  }
}

export async function rejectStoredDemoImport(input: unknown): Promise<ActionResult<Awaited<ReturnType<typeof rejectStoredDemoImportInTx>>>> {
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

export async function retireGameplaySteamIdentity(input: unknown): Promise<ActionResult<Awaited<ReturnType<typeof retireGameplaySteamIdentityInTx>>>> {
  const parsed = z.object({ aliasId: uuid, reason: z.string().trim().min(2).max(500) }).safeParse(input);
  if (!parsed.success) return failValidation("撤销比赛 Steam 身份的参数无效。");
  try {
    const admin = await requireSuperAdmin();
    const result = await db.transaction((tx) => retireGameplaySteamIdentityInTx(tx, {
      ...parsed.data,
      actorId: auditActorId(admin),
    }));
    return ok(result);
  } catch (error) {
    return actionError("retireGameplaySteamIdentity", error);
  }
}
