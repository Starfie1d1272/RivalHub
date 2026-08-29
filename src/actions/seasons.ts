"use server";

import { revalidatePath } from "next/cache";
import { and, eq, count, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { adminInvites, auditLogs, captainVotes, seasonRegistrations, seasons, teams, users } from "@/db/schema";
import { ok, fail, type ActionResult } from "@/types/action";
import { AppError, ErrorCode, ERROR_MESSAGES } from "@/lib/errors";
import { actionError } from "@/lib/action-utils";
import { parseCSTInput } from "@/lib/utils/date";
import { auditActorId, requireSuperAdmin } from "@/lib/auth/session";
import { normalizeRegistrationConfig, type StagePlan } from "@/types/season";
import { validateCompetitionDefinition } from "@/lib/competition/definition";
import { assertSeasonHasNoHistoricalFacts, freezeCompetitiveContext, unfreezeBuiltInCompetitiveContext } from "@/lib/seasons/lifecycle";
import { seasonFormSchema, seasonUpdateFormSchema, planSeasonCreate, planSeasonUpdate, type SeasonFormInput } from "@/lib/seasons/edit";

export type { SeasonFormInput };

function toDate(value: string | null): Date | null {
  return parseCSTInput(value);
}

function toDbDates(parsed: { startAt: string | null; registrationDeadline: string | null; endAt: string | null }) {
  return {
    startAt: toDate(parsed.startAt),
    registrationDeadline: toDate(parsed.registrationDeadline),
    endAt: toDate(parsed.endAt),
  };
}

function fieldErrorsFromZod(error: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join(".");
    if (path && !fieldErrors[path]) fieldErrors[path] = issue.message;
  }
  return fieldErrors;
}

function assertRunnableCustomDefinition(season: Pick<typeof seasons.$inferSelect, "stagePlan" | "positions" | "registrationConfig" | "minTeamSize" | "maxTeamSize" | "starterCount">): void {
  const issues = validateCompetitionDefinition({
    stagePlan: season.stagePlan as StagePlan,
    positions: season.positions,
    registrationConfig: normalizeRegistrationConfig(season.registrationConfig),
    minTeamSize: season.minTeamSize,
    maxTeamSize: season.maxTeamSize,
    starterCount: season.starterCount,
  });
  if (issues.length > 0) throw new AppError(ErrorCode.VALIDATION_FAILED, issues[0]!.message);
}

export async function createSeason(input: SeasonFormInput): Promise<ActionResult<{ seasonId: string; slug: string }>> {
  try {
    const admin = await requireSuperAdmin();
    const parsed = seasonFormSchema.safeParse(input);
    if (!parsed.success) {
      return fail({
        code: ErrorCode.VALIDATION_FAILED,
        message: "赛季配置校验失败",
        fieldErrors: fieldErrorsFromZod(parsed.error),
      });
    }

    const plan = planSeasonCreate(parsed.data);
    const [season] = await db.insert(seasons).values({
      ...plan.set,
      ...toDbDates(parsed.data),
    }).returning({ id: seasons.id, slug: seasons.slug });

    await db.insert(auditLogs).values({
      seasonId: season.id,
      action: "season.create",
      actorId: auditActorId(admin),
      targetId: season.id,
      targetType: "season",
      meta: { slug: season.slug },
    });

    revalidatePath("/admin");
    return ok({ seasonId: season.id, slug: season.slug });
  } catch (e) {
    return actionError("createSeason", e);
  }
}

export async function updateSeason(input: SeasonFormInput): Promise<ActionResult<{ slug: string }>> {
  try {
    const admin = await requireSuperAdmin();
    const parsed = seasonUpdateFormSchema.safeParse(input);
    if (!parsed.success) {
      return fail({
        code: ErrorCode.VALIDATION_FAILED,
        message: "赛季配置校验失败",
        fieldErrors: fieldErrorsFromZod(parsed.error),
      });
    }

    const existing = await db.query.seasons.findFirst({
      where: eq(seasons.id, parsed.data.id),
    });
    if (!existing) throw new AppError(ErrorCode.SEASON_NOT_FOUND, ERROR_MESSAGES.SEASON_NOT_FOUND);
    if (existing.slug !== parsed.data.slug) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "编辑赛季时不能修改 slug");
    }
    const { template, set } = planSeasonUpdate(existing, parsed.data);

    await db.update(seasons).set({
      ...set,
      ...toDbDates(parsed.data),
    }).where(eq(seasons.id, existing.id));

    await db.insert(auditLogs).values({
      seasonId: existing.id,
      action: "season.update",
      actorId: auditActorId(admin),
      targetId: existing.id,
      targetType: "season",
      meta: { slug: existing.slug, template, metadataOnly: !("stagePlan" in set) },
    });

    revalidatePath("/admin");
    revalidatePath(`/admin/${existing.slug}/settings`);
    return ok({ slug: existing.slug });
  } catch (e) {
    return actionError("updateSeason", e);
  }
}

export async function publishSeason(seasonId: string): Promise<ActionResult<{ slug: string }>> {  try {
    const admin = await requireSuperAdmin();
    const season = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM seasons WHERE id = ${seasonId} FOR UPDATE`);
      const locked = await tx.query.seasons.findFirst({ where: eq(seasons.id, seasonId) });
      if (!locked) throw new AppError(ErrorCode.SEASON_NOT_FOUND, ERROR_MESSAGES.SEASON_NOT_FOUND);
      if (locked.status !== "draft") throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "只有 draft 状态可发布");
      if (locked.competitionTemplate === "custom") assertRunnableCustomDefinition(locked);
      const teamRegistrationConfig = await freezeCompetitiveContext(tx, locked);
      await tx.update(seasons).set({ status: "registration", teamRegistrationConfig, updatedAt: new Date() }).where(eq(seasons.id, seasonId));
      await tx.insert(auditLogs).values({
        seasonId,
        action: "season.publish",
        actorId: auditActorId(admin),
        targetId: seasonId,
        targetType: "season",
        meta: { slug: locked.slug, from: "draft", to: "registration", competitiveContextFrozen: Boolean(teamRegistrationConfig.competitiveProfile?.currentSeasonKey) },
      });
      return locked;
    });

    revalidatePath("/admin");
    revalidatePath(`/admin/${season.slug}/settings`);
    revalidatePath(`/${season.slug}`);
    revalidatePath("/seasons");
    return ok({ slug: season.slug });
  } catch (e) {
    return actionError("publishSeason", e);
  }
}

export async function deleteSeason(seasonId: string): Promise<ActionResult<void>> {
  try {
    const admin = await requireSuperAdmin();
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM seasons WHERE id = ${seasonId} FOR UPDATE`);
      const season = await tx.query.seasons.findFirst({ where: eq(seasons.id, seasonId) });
      if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, ERROR_MESSAGES.SEASON_NOT_FOUND);
      if (season.status !== "draft") throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "只有 draft 状态可删除");
      await assertSeasonHasNoHistoricalFacts(tx, seasonId);
      const usedInvite = await tx.query.adminInvites.findFirst({
        where: and(eq(adminInvites.seasonId, seasonId), sql`${adminInvites.usedCount} > 0`),
        columns: { id: true },
      });
      if (usedInvite) throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "该赛季已有管理员授权记录，不能删除。");
      await tx.delete(adminInvites).where(eq(adminInvites.seasonId, seasonId));
      await tx.update(users).set({ adminSeasonIds: sql`array_remove(${users.adminSeasonIds}, ${seasonId}::uuid)`, updatedAt: new Date() })
        .where(sql`${seasonId}::uuid = ANY(${users.adminSeasonIds})`);
      await tx.delete(seasons).where(eq(seasons.id, seasonId));
      await tx.insert(auditLogs).values({
        seasonId: null,
        action: "season.deleted",
        actorId: auditActorId(admin),
        targetId: seasonId,
        targetType: "season",
        meta: { slug: season.slug },
      });
    });

    revalidatePath("/admin");
    return ok(undefined);
  } catch (e) {
    return actionError("deleteSeason", e);
  }
}

/**
 * 撤回赛季发布：registration → draft。仅当赛季没有产生任何报名、队伍或比赛
 * 事实时允许；built-in 赛事同时解除 publish 时冻结的竞技档案上下文，下一次
 * 发布会从平台赛季目录重新解析 current/previous。
 */
export async function revertSeasonToDraft(seasonId: string): Promise<ActionResult<{ slug: string }>> {
  try {
    const admin = await requireSuperAdmin();
    const season = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM seasons WHERE id = ${seasonId} FOR UPDATE`);
      const locked = await tx.query.seasons.findFirst({ where: eq(seasons.id, seasonId) });
      if (!locked) throw new AppError(ErrorCode.SEASON_NOT_FOUND, ERROR_MESSAGES.SEASON_NOT_FOUND);
      if (locked.status !== "registration") {
        throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "只有 registration 状态可撤回至草稿");
      }
      await assertSeasonHasNoHistoricalFacts(tx, seasonId, "该赛季已经产生报名、队伍或赛程事实，不能撤回至草稿。");
      const teamRegistrationConfig = unfreezeBuiltInCompetitiveContext(locked);
      await tx.update(seasons).set({
        status: "draft",
        ...(teamRegistrationConfig ? { teamRegistrationConfig } : {}),
        updatedAt: new Date(),
      }).where(eq(seasons.id, seasonId));
      await tx.insert(auditLogs).values({
        seasonId,
        action: "season.revert_to_draft",
        actorId: auditActorId(admin),
        targetId: seasonId,
        targetType: "season",
        meta: { slug: locked.slug, from: "registration", to: "draft", competitiveContextUnfrozen: teamRegistrationConfig !== null },
      });
      return locked;
    });

    revalidatePath("/admin");
    revalidatePath(`/admin/${season.slug}/settings`);
    revalidatePath(`/${season.slug}`);
    return ok({ slug: season.slug });
  } catch (e) {
    return actionError("revertSeasonToDraft", e);
  }
}

/** 撤回队长确认：voting → registration（清空投票记录） */
export async function revertSeasonToRegistration(seasonId: string): Promise<ActionResult<{ slug: string }>> {
  try {
    const admin = await requireSuperAdmin();
    const season = await db.query.seasons.findFirst({
      where: eq(seasons.id, seasonId),
    });
    if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, ERROR_MESSAGES.SEASON_NOT_FOUND);
    if (season.status !== "voting") {
      throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "只有 voting 状态可撤回至报名");
    }

    const [existingTeamCount] = await db
      .select({ count: count() })
      .from(teams)
      .where(eq(teams.seasonId, seasonId));
    if (Number(existingTeamCount?.count ?? 0) > 0) {
      throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "已生成队伍，不能撤回至报名");
    }

    await db.transaction(async (tx) => {
      const regIds = tx
        .select({ id: seasonRegistrations.id })
        .from(seasonRegistrations)
        .where(eq(seasonRegistrations.seasonId, seasonId));
      await tx.delete(captainVotes).where(
        inArray(captainVotes.voterRegistrationId, regIds),
      );
      await tx.update(seasons).set({
        status: "registration",
        updatedAt: new Date(),
      }).where(eq(seasons.id, seasonId));

      await tx.insert(auditLogs).values({
        seasonId,
        action: "season.revert_to_registration",
        actorId: auditActorId(admin),
        targetId: seasonId,
        targetType: "season",
        meta: { slug: season.slug, from: "voting", to: "registration" },
      });
    });

    revalidatePath("/admin");
    revalidatePath(`/admin/${season.slug}/settings`);
    revalidatePath(`/${season.slug}`);
    return ok({ slug: season.slug });
  } catch (e) {
    return actionError("revertSeasonToRegistration", e);
  }
}

/** 手动结束赛季：playing → finished（管理员 fallback） */
export async function forceFinishSeason(seasonId: string): Promise<ActionResult<{ slug: string }>> {
  try {
    const admin = await requireSuperAdmin();
    const season = await db.query.seasons.findFirst({
      where: eq(seasons.id, seasonId),
    });
    if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, ERROR_MESSAGES.SEASON_NOT_FOUND);
    if (season.status !== "playing") {
      throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "只有 playing 状态可手动结束");
    }

    await db.update(seasons).set({
      status: "finished",
      updatedAt: new Date(),
    }).where(eq(seasons.id, seasonId));

    await db.insert(auditLogs).values({
      seasonId,
      action: "season.force_finish",
      actorId: auditActorId(admin),
      targetId: seasonId,
      targetType: "season",
      meta: { slug: season.slug, from: "playing", to: "finished" },
    });

    revalidatePath("/admin");
    revalidatePath(`/admin/${season.slug}/settings`);
    revalidatePath(`/${season.slug}`);
    return ok({ slug: season.slug });
  } catch (e) {
    return actionError("forceFinishSeason", e);
  }
}

/** 归档赛季：finished → archived */
export async function archiveSeason(seasonId: string): Promise<ActionResult<{ slug: string }>> {
  try {
    const admin = await requireSuperAdmin();
    const season = await db.query.seasons.findFirst({
      where: eq(seasons.id, seasonId),
    });
    if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, ERROR_MESSAGES.SEASON_NOT_FOUND);
    if (season.status !== "finished") {
      throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "只有 finished 状态可归档");
    }

    await db.update(seasons).set({
      status: "archived",
      updatedAt: new Date(),
    }).where(eq(seasons.id, seasonId));

    await db.insert(auditLogs).values({
      seasonId,
      action: "season.archive",
      actorId: auditActorId(admin),
      targetId: seasonId,
      targetType: "season",
      meta: { slug: season.slug, from: "finished", to: "archived" },
    });

    revalidatePath("/admin");
    revalidatePath(`/admin/${season.slug}/settings`);
    revalidatePath(`/${season.slug}`);
    return ok({ slug: season.slug });
  } catch (e) {
    return actionError("archiveSeason", e);
  }
}
