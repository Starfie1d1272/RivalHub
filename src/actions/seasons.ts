"use server";

import { revalidatePath } from "next/cache";
import { eq, count, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { auditLogs, captainVotes, seasonRegistrations, seasons, teams } from "@/db/schema";
import { ok, fail, type ActionResult } from "@/types/action";
import { AppError, ErrorCode, ERROR_MESSAGES } from "@/lib/errors";
import { actionError } from "@/lib/action-utils";
import { parseCSTInput } from "@/lib/utils/date";
import { auditActorId, requireSuperAdmin } from "@/lib/auth/session";
import {
  normalizeRegistrationConfig,
  normalizeTeamRegistrationConfig,
  type RegistrationConfig,
  type TeamRegistrationConfig,
  type StagePlan,
} from "@/types/season";

const stageConfigSchema = z.object({
  key: z.string().min(1).regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1),
  type: z.enum(["round_robin", "double_elim", "single_elim", "swiss", "gsl_group"]),
  teamCount: z.number().int().min(2).max(128),
  advanceTiers: z.array(z.object({
    placement: z.string().min(1),
    count: z.number().int().min(1),
    targetRound: z.string().optional(),
  })),
  groupCount: z.number().int().min(1).optional(),
  matchFormat: z.enum(["bo1", "bo3", "bo5"]).optional(),
  finalFormat: z.enum(["bo3", "bo5"]).optional(),
  hasThirdPlaceMatch: z.boolean().optional(),
  seeds: z.array(z.number().int().positive()).optional(),
  entrySeeds: z.number().int().min(0).optional(),
});

const stagePlanSchema = z.array(stageConfigSchema);

const registrationConfigSchema = z.object({
  allowedPlayerTypes: z.array(z.enum(["enrolled", "graduated", "external"])).min(1),
  rankThreshold: z.object({
    currentMin: z.string().min(1).nullable(),
    peakMin: z.string().min(1).nullable(),
  }),
  maxPerPosition: z.number().int().min(1).max(50),
  screenshotCount: z.number().int().min(1).max(5),
  maxTotal: z.number().int().min(1).max(1000),
  mapPool: z.array(z.string().min(1).regex(/^de_[a-z0-9_]+$/)).min(3).max(12),
});

const seasonFormBaseSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1, "请填写赛季名称"),
  slug: z.string().min(1, "请填写 slug").regex(/^[a-z0-9][a-z0-9-]*$/, "slug 只能使用小写字母、数字和连字符"),
  kind: z.string().min(1, "请填写赛事类型"),
  status: z.enum(["draft", "registration", "voting", "drafting", "playing", "finished", "archived"]).optional(),
  themeColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "主题色需为 #RRGGBB 格式").nullable(),
  startAt: z.string().nullable(),
  registrationDeadline: z.string().nullable(),
  endAt: z.string().nullable(),
  registrationMode: z.enum(["solo", "team"]),
  hasCaptainVoting: z.boolean(),
  hasDraft: z.boolean(),
  minTeamSize: z.number().int().min(1).max(20),
  maxTeamSize: z.number().int().min(1).max(20),
  starterCount: z.number().int().min(1).max(20),
  positions: z.array(z.string().min(1)).min(1),
  stagePlan: stagePlanSchema,
  registrationConfig: registrationConfigSchema,
  teamRegistrationConfig: z.object({
    allowExternal: z.boolean(),
    graduateCountsAsHome: z.boolean(),
    minHomeMembers: z.number().int().min(0),
    minEnrolledMembers: z.number().int().min(0),
    maxExternalMembers: z.number().int().min(0),
    requirePositions: z.boolean(),
    maxPerPositionPerTeam: z.number().int().min(1),
    captainCanKick: z.boolean(),
    captainCanTransfer: z.boolean(),
    lockAfterRegistration: z.boolean(),
    requireUniqueTeamName: z.boolean(),
    requireTeamLogo: z.boolean(),
  }).optional(),
});

const seasonFormSchema = withSeasonRefinements(seasonFormBaseSchema);

export type SeasonFormInput = z.input<typeof seasonFormSchema>;

function withSeasonRefinements<T extends z.ZodTypeAny>(schema: T) {
  return schema
    .refine((data) => data.starterCount <= data.maxTeamSize, {
      path: ["starterCount"],
      message: "首发人数不能超过队伍上限",
    })
    .refine((data) => data.minTeamSize <= data.maxTeamSize, {
      path: ["minTeamSize"],
      message: "最小人数不能超过最大人数",
    })
    .refine(
      (data) => {
        if (!data.startAt || !data.registrationDeadline) return true;
        return new Date(data.registrationDeadline) > new Date(data.startAt);
      },
      {
        path: ["registrationDeadline"],
        message: "报名截止时间必须晚于报名开始时间",
      },
    );
}

function toDate(value: string | null): Date | null {
  return parseCSTInput(value);
}

function fieldErrorsFromZod(error: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join(".");
    if (path && !fieldErrors[path]) fieldErrors[path] = issue.message;
  }
  return fieldErrors;
}

function assertUniqueStageKeys(stagePlan: StagePlan): void {
  const keys = new Set<string>();
  for (const stage of stagePlan) {
    if (keys.has(stage.key)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, `stage key 重复: ${stage.key}`);
    }
    keys.add(stage.key);
  }
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

    const data = parsed.data;
    assertUniqueStageKeys(data.stagePlan as StagePlan);

    const [season] = await db.insert(seasons).values({
      slug: data.slug,
      name: data.name,
      kind: data.kind,
      status: "draft",
      themeColor: data.themeColor,
      registrationMode: data.registrationMode,
      hasCaptainVoting: data.hasCaptainVoting,
      hasDraft: data.hasDraft,
      minTeamSize: data.minTeamSize,
      maxTeamSize: data.maxTeamSize,
      starterCount: data.starterCount,
      positions: data.positions,
      stagePlan: data.stagePlan as StagePlan,
      registrationConfig: normalizeRegistrationConfig(data.registrationConfig as RegistrationConfig),
      teamRegistrationConfig: normalizeTeamRegistrationConfig(
        (data.teamRegistrationConfig ?? {}) as TeamRegistrationConfig,
      ),
      startAt: toDate(data.startAt),
      registrationDeadline: toDate(data.registrationDeadline),
      endAt: toDate(data.endAt),
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
    const updateSchema = withSeasonRefinements(
      seasonFormBaseSchema.extend({ id: z.string().uuid() }),
    );
    const parsed = updateSchema.safeParse(input);
    if (!parsed.success) {
      return fail({
        code: ErrorCode.VALIDATION_FAILED,
        message: "赛季配置校验失败",
        fieldErrors: fieldErrorsFromZod(parsed.error),
      });
    }

    const data = parsed.data;
    assertUniqueStageKeys(data.stagePlan as StagePlan);

    const existing = await db.query.seasons.findFirst({
      where: eq(seasons.id, data.id),
    });
    if (!existing) throw new AppError(ErrorCode.SEASON_NOT_FOUND, ERROR_MESSAGES.SEASON_NOT_FOUND);
    if (existing.slug !== data.slug) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "编辑赛季时不能修改 slug");
    }

    if (existing.status !== "draft") {
      const coreChanged =
        existing.registrationMode !== data.registrationMode ||
        existing.hasCaptainVoting !== data.hasCaptainVoting ||
        existing.hasDraft !== data.hasDraft ||
        existing.maxTeamSize !== data.maxTeamSize ||
        existing.minTeamSize !== data.minTeamSize ||
        existing.starterCount !== data.starterCount ||
        JSON.stringify(existing.positions) !== JSON.stringify(data.positions) ||
        JSON.stringify(existing.stagePlan) !== JSON.stringify(data.stagePlan);
      if (coreChanged) {
        throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "只有 draft 状态可修改核心赛季配置");
      }
    }

    await db.update(seasons).set({
      name: data.name,
      kind: data.kind,
      themeColor: data.themeColor,
      registrationMode: data.registrationMode,
      hasCaptainVoting: data.hasCaptainVoting,
      hasDraft: data.hasDraft,
      minTeamSize: data.minTeamSize,
      maxTeamSize: data.maxTeamSize,
      starterCount: data.starterCount,
      positions: data.positions,
      stagePlan: data.stagePlan as StagePlan,
      registrationConfig: normalizeRegistrationConfig(data.registrationConfig as RegistrationConfig),
      teamRegistrationConfig: normalizeTeamRegistrationConfig(
        (data.teamRegistrationConfig ?? {}) as TeamRegistrationConfig,
      ),
      startAt: toDate(data.startAt),
      registrationDeadline: toDate(data.registrationDeadline),
      endAt: toDate(data.endAt),
      updatedAt: new Date(),
    }).where(eq(seasons.id, data.id));

    await db.insert(auditLogs).values({
      seasonId: data.id,
      action: "season.update",
      actorId: auditActorId(admin),
      targetId: data.id,
      targetType: "season",
      meta: { slug: existing.slug },
    });

    revalidatePath("/admin");
    revalidatePath(`/admin/${existing.slug}/settings`);
    return ok({ slug: existing.slug });
  } catch (e) {
    return actionError("updateSeason", e);
  }
}

export async function publishSeason(seasonId: string): Promise<ActionResult<{ slug: string }>> {
  try {
    const admin = await requireSuperAdmin();
    const season = await db.query.seasons.findFirst({
      where: eq(seasons.id, seasonId),
    });
    if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, ERROR_MESSAGES.SEASON_NOT_FOUND);
    if (season.status !== "draft") {
      throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "只有 draft 状态可发布");
    }

    await db.update(seasons).set({
      status: "registration",
      updatedAt: new Date(),
    }).where(eq(seasons.id, seasonId));

    await db.insert(auditLogs).values({
      seasonId,
      action: "season.publish",
      actorId: auditActorId(admin),
      targetId: seasonId,
      targetType: "season",
      meta: { slug: season.slug, from: "draft", to: "registration" },
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
    const season = await db.query.seasons.findFirst({
      where: eq(seasons.id, seasonId),
    });
    if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, ERROR_MESSAGES.SEASON_NOT_FOUND);
    if (season.status !== "draft") {
      throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "只有 draft 状态可删除");
    }

    const [{ value: registrationCount }] = await db
      .select({ value: count() })
      .from(seasonRegistrations)
      .where(eq(seasonRegistrations.seasonId, seasonId));
    if (registrationCount > 0) {
      throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "已有报名记录，不能删除赛季");
    }

    await db.insert(auditLogs).values({
      seasonId: null,
      action: "season.deleted",
      actorId: auditActorId(admin),
      targetId: seasonId,
      targetType: "season",
      meta: { slug: season.slug },
    });
    await db.delete(seasons).where(eq(seasons.id, seasonId));

    revalidatePath("/admin");
    return ok(undefined);
  } catch (e) {
    return actionError("deleteSeason", e);
  }
}

/** 撤回赛季发布：registration → draft（仅当无报名记录时允许） */
export async function revertSeasonToDraft(seasonId: string): Promise<ActionResult<{ slug: string }>> {
  try {
    const admin = await requireSuperAdmin();
    const season = await db.query.seasons.findFirst({
      where: eq(seasons.id, seasonId),
    });
    if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, ERROR_MESSAGES.SEASON_NOT_FOUND);
    if (season.status !== "registration") {
      throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "只有 registration 状态可撤回至草稿");
    }

    const [row] = await db
      .select({ cnt: count() })
      .from(seasonRegistrations)
      .where(eq(seasonRegistrations.seasonId, seasonId));
    const regCount = Number(row?.cnt ?? 0);
    if (regCount > 0) {
      throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "已有报名记录，不能撤回至草稿");
    }

    await db.update(seasons).set({
      status: "draft",
      updatedAt: new Date(),
    }).where(eq(seasons.id, seasonId));

    await db.insert(auditLogs).values({
      seasonId,
      action: "season.revert_to_draft",
      actorId: auditActorId(admin),
      targetId: seasonId,
      targetType: "season",
      meta: { slug: season.slug, from: "registration", to: "draft" },
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
