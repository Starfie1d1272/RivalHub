"use server";

import { writeAuditInTx } from "@/lib/audit/write";

import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  seasons,
  competitionEntries,
  draftState,
  } from "@/db/schema";
import { ok, type ActionResult } from "@/types/action";
import { AppError, ErrorCode, ERROR_MESSAGES } from "@/lib/errors";
import { auditActorId, requireSeasonAdmin } from "@/lib/auth/session";
import { failValidation, actionError } from "@/lib/action-utils";
import { revalidateSeasonPaths } from "@/lib/revalidation";
import {
  startDraftSchema,
  pauseDraftSchema,
  resumeDraftSchema,
  type StartDraftInput,
  type PauseDraftInput,
  type ResumeDraftInput,
} from "@/lib/validators/draft";
import { draftFormat, getSnakeOrder } from "@/lib/draft/rules";
import { assertFormationRulesPublishable, decodeSeasonRules } from "@/lib/seasons/rules";

// ── 启动选秀 ───────────────────────────────────────────

export async function startDraft(
  input: StartDraftInput,
): Promise<ActionResult<{ draftStateId: string }>> {
  const parsed = startDraftSchema.safeParse(input);
  if (!parsed.success) {
    return failValidation("启动选秀参数无效");
  }

  const { seasonId } = parsed.data;
  const admin = await requireSeasonAdmin(seasonId);

  try {
    const result = await db.transaction(async (tx) => {
      const season = await tx.query.seasons.findFirst({
        where: eq(seasons.id, seasonId),
      });
      if (!season) {
        throw new AppError(ErrorCode.SEASON_NOT_FOUND, ERROR_MESSAGES.SEASON_NOT_FOUND);
      }
      const rules = decodeSeasonRules(season);
      if (rules.source === "policy_v2") assertFormationRulesPublishable(rules);
      const format = draftFormat(rules);
      if (!season.hasDraft) {
        throw new AppError(
          ErrorCode.SEASON_CAPABILITY_DISABLED,
          ERROR_MESSAGES.SEASON_CAPABILITY_DISABLED,
        );
      }
      if (season.status !== "drafting") {
        throw new AppError(
          ErrorCode.SEASON_INVALID_STATUS,
          "只有 drafting 状态的赛季可以启动选秀",
        );
      }

      const existing = await tx.query.draftState.findFirst({
        where: eq(draftState.seasonId, seasonId),
      });
      if (existing) {
        throw new AppError(
          ErrorCode.SEASON_INVALID_STATUS,
          "选秀已启动",
        );
      }

      const seasonTeams = await tx
        .select({ id: competitionEntries.id, draftOrder: sql<number>`${competitionEntries.formationOrder}`.as("draft_order") })
        .from(competitionEntries)
        .where(and(eq(competitionEntries.competitionId, seasonId), isNotNull(competitionEntries.formationOrder)))
        .orderBy(asc(competitionEntries.formationOrder));

      if (seasonTeams.length === 0) {
        throw new AppError(
          ErrorCode.VALIDATION_FAILED,
          "该赛季没有队伍，请先确认队长生成队伍",
        );
      }
      if (format.rounds < 0 || (format.teamCount > 0 && seasonTeams.length !== format.teamCount)) {
        throw new AppError(
          ErrorCode.VALIDATION_FAILED,
          `选秀轮数无效或队伍数不匹配（当前 ${seasonTeams.length} 支）`,
        );
      }
      if (!hasSequentialDraftOrder(seasonTeams)) {
        throw new AppError(
          ErrorCode.VALIDATION_FAILED,
          `队伍顺序必须为 1-${seasonTeams.length} 且不能重复`,
        );
      }

      const order = getSnakeOrder(seasonTeams, 1);
      const firstEntryId = format.rounds ? order[0].id : null;
      const deadline = format.rounds ? new Date(Date.now() + format.timeoutSeconds * 1000) : null;

      const [draft] = await tx
        .insert(draftState)
        .values({
          seasonId,
          currentRound: 1,
          currentEntryId: firstEntryId,
          roundDeadline: deadline,
          isActive: format.rounds > 0,
        })
        .returning({ id: draftState.id });

      await writeAuditInTx(tx, {
        seasonId,
        action: "draft.start",
        actorId: auditActorId(admin),
        targetId: seasonId,meta: { firstEntryId, roundDeadline: deadline?.toISOString() ?? null, actorEmail: admin.email },
      });

      return { draftStateId: draft.id, slug: season.slug };
    });

    revalidateSeasonPaths(result.slug, ["draft", "adminDraft"]);
    return ok({ draftStateId: result.draftStateId });
  } catch (e) {
    return actionError("startDraft", e);
  }
}

// ── 暂停选秀 ───────────────────────────────────────────

export async function pauseDraft(
  input: PauseDraftInput,
): Promise<ActionResult<{ paused: boolean }>> {
  const parsed = pauseDraftSchema.safeParse(input);
  if (!parsed.success) {
    return failValidation("暂停选秀参数无效");
  }
  const admin = await requireSeasonAdmin(parsed.data.seasonId);

  try {
    const result = await db.transaction(async (tx) => {
      const ds = await tx.query.draftState.findFirst({
        where: eq(draftState.seasonId, parsed.data.seasonId),
      });
      if (!ds) {
        throw new AppError(ErrorCode.DRAFT_NOT_ACTIVE, ERROR_MESSAGES.DRAFT_NOT_ACTIVE);
      }
      if (!ds.isActive) {
        throw new AppError(ErrorCode.DRAFT_NOT_ACTIVE, "选秀未在进行中");
      }

      await tx
        .update(draftState)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(draftState.id, ds.id));

      await writeAuditInTx(tx, {
        seasonId: parsed.data.seasonId,
        action: "draft.pause",
        actorId: auditActorId(admin),
        targetId: ds.id,meta: { actorEmail: admin.email },
      });

      const season = await tx.query.seasons.findFirst({
        where: eq(seasons.id, parsed.data.seasonId),
      });
      return { slug: season?.slug ?? "" };
    });

    revalidateSeasonPaths(result.slug, ["draft", "adminDraft"]);
    return ok({ paused: true });
  } catch (e) {
    return actionError("pauseDraft", e);
  }
}

// ── 恢复选秀 ───────────────────────────────────────────

export async function resumeDraft(
  input: ResumeDraftInput,
): Promise<ActionResult<{ resumed: boolean }>> {
  const parsed = resumeDraftSchema.safeParse(input);
  if (!parsed.success) {
    return failValidation("恢复选秀参数无效");
  }
  const admin = await requireSeasonAdmin(parsed.data.seasonId);

  try {
    const result = await db.transaction(async (tx) => {
      const ds = await tx.query.draftState.findFirst({
        where: eq(draftState.seasonId, parsed.data.seasonId),
      });
      if (!ds) {
        throw new AppError(ErrorCode.DRAFT_NOT_ACTIVE, ERROR_MESSAGES.DRAFT_NOT_ACTIVE);
      }
      if (ds.isActive) {
        throw new AppError(ErrorCode.DRAFT_NOT_ACTIVE, "选秀已在进行中");
      }
      if (!ds.currentEntryId) {
        throw new AppError(ErrorCode.DRAFT_NOT_ACTIVE, "选秀状态异常");
      }

      const season = await tx.query.seasons.findFirst({ where: eq(seasons.id, parsed.data.seasonId) });
      if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, ERROR_MESSAGES.SEASON_NOT_FOUND);
      const deadline = new Date(Date.now() + draftFormat(decodeSeasonRules(season)).timeoutSeconds * 1000);

      await tx
        .update(draftState)
        .set({ isActive: true, roundDeadline: deadline, updatedAt: new Date() })
        .where(eq(draftState.id, ds.id));

      await writeAuditInTx(tx, {
        seasonId: parsed.data.seasonId,
        action: "draft.resume",
        actorId: auditActorId(admin),
        targetId: ds.id,meta: { roundDeadline: deadline.toISOString(), actorEmail: admin.email },
      });

      return { slug: season?.slug ?? "" };
    });

    revalidateSeasonPaths(result.slug, ["draft", "adminDraft"]);
    return ok({ resumed: true });
  } catch (e) {
    return actionError("resumeDraft", e);
  }
}

// ── 工具函数 ───────────────────────────────────────────

function hasSequentialDraftOrder(teamRows: { draftOrder: number }[]): boolean {
  const orders = new Set(teamRows.map((team) => team.draftOrder));
  if (orders.size !== teamRows.length) return false;
  for (let order = 1; order <= teamRows.length; order++) {
    if (!orders.has(order)) return false;
  }
  return true;
}
