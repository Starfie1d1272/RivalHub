"use server";

import { and, asc, eq, ilike, or } from "drizzle-orm";
import { db } from "@/db/client";
import {
  disciplinaryCases,
  seasons,
  users,
  type DisciplinaryCase,
} from "@/db/schema";
import { z } from "zod";
import { ok } from "@/types/action";
import type { ActionResult } from "@/types/action";
import { requireSeasonAdmin, auditActorId } from "@/lib/auth/session";
import { actionError } from "@/lib/action-utils";
import { AppError, ErrorCode } from "@/lib/errors";
import { revalidateSeasonPaths } from "@/lib/revalidation";
import {
  issueSanctionInTx,
  markSanctionExpiredInTx,
  resolveSanctionStatus,
  revokeSanctionInTx,
  serializeSanctionPublic,
  SANCTION_EFFECTS,
  type SanctionEffect,
} from "@/lib/discipline/service";

const effectSchema = z.enum(SANCTION_EFFECTS as unknown as [SanctionEffect, ...SanctionEffect[]]);

const issueSchema = z.object({
  seasonId: z.string().uuid(),
  subjectUserId: z.string().uuid(),
  effects: z.array(effectSchema).min(1),
  internalEvidence: z.string().trim().max(4000).optional().nullable(),
  publicExplanation: z.string().trim().max(1000).optional().nullable(),
  effectiveUntil: z.coerce.date().optional().nullable(),
});

/**
 * 管理员签发个人纪律处罚（直接进入 active 状态，按窗口生效）。
 * 只作用于 subject 本人的指定能力——绝不连带队伍或历史事实。
 */
export async function issueSanction(input: unknown): Promise<ActionResult<{ caseId: string }>> {
  const parsed = issueSchema.safeParse(input);
  if (!parsed.success) return actionError("issueSanction", new AppError(ErrorCode.VALIDATION_FAILED, "处罚参数不合法。"));
  try {
    const admin = await requireSeasonAdmin(parsed.data.seasonId);
    const result = await db.transaction((tx) =>
      issueSanctionInTx(tx, {
        seasonId: parsed.data.seasonId,
        subjectUserId: parsed.data.subjectUserId,
        effects: parsed.data.effects,
        internalEvidence: parsed.data.internalEvidence ?? null,
        publicExplanation: parsed.data.publicExplanation ?? null,
        effectiveFrom: new Date(),
        effectiveUntil: parsed.data.effectiveUntil ?? null,
        actorId: auditActorId(admin),
      }),
    );
    const season = await db.query.seasons.findFirst({
      where: eq(seasons.id, parsed.data.seasonId),
      columns: { slug: true },
    });
    if (season) revalidateSeasonPaths(season.slug, ["adminMatches"]);
    return ok(result);
  } catch (e) {
    return actionError("issueSanction", e);
  }
}

/**
 * 撤销处罚。重复撤销为幂等成功且不产生重复审计。
 */
export async function revokeSanction(
  input: { caseId: string; reason: string },
): Promise<ActionResult<{ alreadyRevoked: boolean; caseId: string }>> {
  const parsed = z
    .object({ caseId: z.string().uuid(), reason: z.string().trim().min(1).max(1000) })
    .safeParse(input);
  if (!parsed.success) return actionError("revokeSanction", new AppError(ErrorCode.VALIDATION_FAILED, "撤销参数不合法：必须填写撤销原因。"));
  try {
    const existing = await loadCase(parsed.data.caseId);
    const admin = await requireSeasonAdmin(existing.seasonId);
    const result = await db.transaction((tx) =>
      revokeSanctionInTx(tx, {
        caseId: existing.id,
        actorId: auditActorId(admin),
        reason: parsed.data.reason,
      }),
    );
    return ok(result);
  } catch (e) {
    return actionError("revokeSanction", e);
  }
}

export async function expireSanction(
  input: { caseId: string },
): Promise<ActionResult<{ alreadyExpired: boolean; caseId: string }>> {
  const parsed = z.object({ caseId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return actionError("expireSanction", new AppError(ErrorCode.VALIDATION_FAILED, "参数不合法。"));
  try {
    const existing = await loadCase(parsed.data.caseId);
    const admin = await requireSeasonAdmin(existing.seasonId);
    const result = await db.transaction((tx) =>
      markSanctionExpiredInTx(tx, { caseId: existing.id, actorId: auditActorId(admin) }),
    );
    return ok(result);
  } catch (e) {
    return actionError("expireSanction", e);
  }
}

/** 按 displayName / steamName / email 模糊搜索普通 RivalHub 用户，供处罚 subject 按需选择。 */
export async function searchSanctionSubjects(
  input: unknown,
): Promise<ActionResult<Array<{ id: string; label: string; detail: string | null }>>> {
  const parsed = z
    .object({ seasonId: z.string().uuid(), query: z.string().trim().min(2).max(64) })
    .safeParse(input);
  if (!parsed.success) {
    return actionError("searchSanctionSubjects", new AppError(ErrorCode.VALIDATION_FAILED, "搜索词不合法：至少 2 个字符。"));
  }
  try {
    await requireSeasonAdmin(parsed.data.seasonId);
    const pattern = `%${parsed.data.query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const rows = await db
      .select({
        id: users.id,
        displayName: users.displayName,
        steamName: users.steamName,
        email: users.email,
      })
      .from(users)
      .where(
        or(
          ilike(users.displayName, pattern),
          ilike(users.steamName, pattern),
          ilike(users.email, pattern),
        ),
      )
      .orderBy(asc(users.email))
      .limit(10);
    return ok(
      rows.map((row) => ({
        id: row.id,
        label: row.displayName ?? row.steamName ?? row.email,
        detail: row.email,
      })),
    );
  } catch (e) {
    return actionError("searchSanctionSubjects", e);
  }
}

/** Admin-facing reader: internal evidence stays visible to privileged admins. */
export async function getSeasonSanctions(
  seasonId: string,
): Promise<ActionResult<
  Array<DisciplinaryCase & { resolvedStatus: ReturnType<typeof resolveSanctionStatus> }>
>> {
  try {
    await requireSeasonAdmin(seasonId);
    const rows = await db
      .select()
      .from(disciplinaryCases)
      .where(eq(disciplinaryCases.seasonId, seasonId));
    const now = new Date();
    return ok(rows.map((row) => ({ ...row, resolvedStatus: resolveSanctionStatus(row, now) })));
  } catch (e) {
    return actionError("getSeasonSanctions", e);
  }
}

/**
 * 公开（面向非管理页面）的赛季处罚摘要——内部证据永不序列化。
 */
export async function getSeasonPublicSanctions(
  seasonId: string,
): Promise<ActionResult<ReturnType<typeof serializeSanctionPublic>[]>> {
  try {
    const rows = await db
      .select()
      .from(disciplinaryCases)
      .where(and(eq(disciplinaryCases.seasonId, seasonId)));
    const now = new Date();
    return ok(rows.map((row) => serializeSanctionPublic(row, now)));
  } catch (e) {
    return actionError("getSeasonPublicSanctions", e);
  }
}

async function loadCase(caseId: string): Promise<DisciplinaryCase> {
  const [row] = await db.select().from(disciplinaryCases).where(eq(disciplinaryCases.id, caseId));
  if (!row) throw new AppError(ErrorCode.NOT_FOUND, "纪律处罚记录不存在。");
  return row;
}
