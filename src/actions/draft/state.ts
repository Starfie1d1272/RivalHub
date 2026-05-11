"use server";

import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  seasons,
  teams,
  draftState,
  auditLogs,
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
import { DRAFT_ROUND_TIMEOUT_SECONDS, DRAFT_TEAMS } from "@/types/draft";
import { getSnakeOrder } from "@/lib/draft/rules";

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
        .select({ id: teams.id, draftOrder: teams.draftOrder })
        .from(teams)
        .where(eq(teams.seasonId, seasonId))
        .orderBy(asc(teams.draftOrder));

      if (seasonTeams.length === 0) {
        throw new AppError(
          ErrorCode.VALIDATION_FAILED,
          "该赛季没有队伍，请先确认队长生成队伍",
        );
      }
      if (seasonTeams.length !== DRAFT_TEAMS) {
        throw new AppError(
          ErrorCode.VALIDATION_FAILED,
          `选秀需要 ${DRAFT_TEAMS} 支队伍，当前为 ${seasonTeams.length} 支`,
        );
      }
      if (!hasSequentialDraftOrder(seasonTeams)) {
        throw new AppError(
          ErrorCode.VALIDATION_FAILED,
          `队伍 draft order 必须为 1-${DRAFT_TEAMS} 且不能重复`,
        );
      }

      const order = getSnakeOrder(seasonTeams, 1);
      const firstTeamId = order[0].id;
      const deadline = new Date(Date.now() + DRAFT_ROUND_TIMEOUT_SECONDS * 1000);

      const [draft] = await tx
        .insert(draftState)
        .values({
          seasonId,
          currentRound: 1,
          currentTeamId: firstTeamId,
          roundDeadline: deadline,
          isActive: true,
        })
        .returning({ id: draftState.id });

      await tx.insert(auditLogs).values({
        seasonId,
        action: "draft.start",
        actorId: auditActorId(admin),
        targetId: seasonId,
        targetType: "season",
        meta: { firstTeamId, roundDeadline: deadline.toISOString(), actorEmail: admin.email },
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

      await tx.insert(auditLogs).values({
        seasonId: parsed.data.seasonId,
        action: "draft.pause",
        actorId: auditActorId(admin),
        targetId: ds.id,
        targetType: "draft_state",
        meta: { actorEmail: admin.email },
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
      if (!ds.currentTeamId) {
        throw new AppError(ErrorCode.DRAFT_NOT_ACTIVE, "选秀状态异常");
      }

      const deadline = new Date(Date.now() + DRAFT_ROUND_TIMEOUT_SECONDS * 1000);

      await tx
        .update(draftState)
        .set({ isActive: true, roundDeadline: deadline, updatedAt: new Date() })
        .where(eq(draftState.id, ds.id));

      await tx.insert(auditLogs).values({
        seasonId: parsed.data.seasonId,
        action: "draft.resume",
        actorId: auditActorId(admin),
        targetId: ds.id,
        targetType: "draft_state",
        meta: { roundDeadline: deadline.toISOString(), actorEmail: admin.email },
      });

      const season = await tx.query.seasons.findFirst({
        where: eq(seasons.id, parsed.data.seasonId),
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
  if (orders.size !== DRAFT_TEAMS) return false;
  for (let order = 1; order <= DRAFT_TEAMS; order++) {
    if (!orders.has(order)) return false;
  }
  return true;
}
