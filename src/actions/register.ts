"use server";

import { revalidatePath } from "next/cache";
import { eq, and, count } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { users, seasons, seasonRegistrations, registrationDrafts, auditLogs } from "@/db/schema";
import { ok, fail } from "@/types/action";
import { AppError, ErrorCode, ERROR_MESSAGES } from "@/lib/errors";
import { actionError } from "@/lib/action-utils";
import { getUserSession } from "@/lib/auth/session";
import { buildRegistrationSchema, registrationSeedSchema, type RegistrationFormData } from "@/lib/validators/registration";
import { normalizeRegistrationConfig } from "@/types/season";
import { getRegistrationWindowState } from "@/lib/registration/window";
import { normalizeEmail } from "@/lib/utils/email";
import { compactUndefined } from "@/lib/utils/object";
import { getSteamAvatar } from "@/lib/steam";

const draftSchema = z.object({
  seasonId: z.string().uuid("赛季 ID 格式不正确"),
  email: z.string().email("请先填写有效邮箱"),
  payload: z.record(z.unknown()).default({}),
});

export async function saveRegistrationDraft(input: unknown) {
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) {
    return fail({
      code: ErrorCode.VALIDATION_FAILED,
      message: "草稿保存失败，请先填写有效邮箱",
      fieldErrors: Object.fromEntries(
        parsed.error.issues.map((issue) => [issue.path.join("."), issue.message]),
      ),
    });
  }

  try {
    const season = await db.query.seasons.findFirst({
      where: eq(seasons.id, parsed.data.seasonId),
    });
    if (!season) {
      throw new AppError(ErrorCode.SEASON_NOT_FOUND, ERROR_MESSAGES.SEASON_NOT_FOUND);
    }

    const windowState = getRegistrationWindowState(season);
    if (!windowState.canSaveDraft) {
      throw new AppError(ErrorCode.REGISTRATION_CLOSED, windowState.message);
    }

    const email = normalizeEmail(parsed.data.email);
    const payload = {
      ...(compactUndefined(parsed.data.payload) as Record<string, unknown>),
      seasonId: parsed.data.seasonId,
      email,
    };

    await db
      .insert(registrationDrafts)
      .values({
        seasonId: parsed.data.seasonId,
        email,
        payload,
      })
      .onConflictDoUpdate({
        target: [registrationDrafts.seasonId, registrationDrafts.email],
        set: { payload, updatedAt: new Date() },
      });

    revalidatePath(`/${season.slug}/register`);
    return ok({ email });
  } catch (e) {
    return actionError("saveRegistrationDraft", e);
  }
}

export async function loadRegistrationDraft(seasonId: string, email: string) {
  const parsed = draftSchema.pick({ seasonId: true, email: true }).safeParse({ seasonId, email });
  if (!parsed.success) {
    return fail({
      code: ErrorCode.VALIDATION_FAILED,
      message: "请输入有效邮箱后再加载草稿",
    });
  }

  try {
    const season = await db.query.seasons.findFirst({
      where: eq(seasons.id, parsed.data.seasonId),
    });
    if (!season) {
      throw new AppError(ErrorCode.SEASON_NOT_FOUND, ERROR_MESSAGES.SEASON_NOT_FOUND);
    }

    const windowState = getRegistrationWindowState(season);
    if (!windowState.canSaveDraft && !windowState.canSubmit) {
      throw new AppError(ErrorCode.REGISTRATION_CLOSED, windowState.message);
    }

    const draft = await db.query.registrationDrafts.findFirst({
      where: and(
        eq(registrationDrafts.seasonId, parsed.data.seasonId),
        eq(registrationDrafts.email, normalizeEmail(parsed.data.email)),
      ),
    });

    return ok({ payload: draft?.payload ?? null });
  } catch (e) {
    return actionError("loadRegistrationDraft", e);
  }
}

/**
 * 提交报名。
 * 要求已登录；未登录请先跳转 /login。
 */
export async function submitRegistration(input: RegistrationFormData) {
  const seedParsed = registrationSeedSchema.safeParse(input);
  if (!seedParsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const [field, errors] of Object.entries(
      seedParsed.error.flatten().fieldErrors
    )) {
      if (errors?.[0]) fieldErrors[field] = errors[0];
    }
    return fail({
      code: ErrorCode.VALIDATION_FAILED,
      message: "输入校验失败，请检查各字段",
      fieldErrors,
    });
  }

  try {
    const season = await db.query.seasons.findFirst({
      where: eq(seasons.id, seedParsed.data.seasonId),
    });
    if (!season) {
      throw new AppError(ErrorCode.SEASON_NOT_FOUND, ERROR_MESSAGES.SEASON_NOT_FOUND);
    }
    const windowState = getRegistrationWindowState(season);
    if (!windowState.canSubmit) {
      throw new AppError(ErrorCode.REGISTRATION_CLOSED, windowState.message);
    }

    const session = await getUserSession();
    if (!session) {
      return fail({
        code: ErrorCode.UNAUTHORIZED,
        message: "请先登录或注册账号后再报名",
      });
    }

    const registrationConfig = normalizeRegistrationConfig(season.registrationConfig);
    const parsed = buildRegistrationSchema(registrationConfig, season.positions).safeParse(input);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const [field, errors] of Object.entries(
        parsed.error.flatten().fieldErrors
      )) {
        if (errors?.[0]) fieldErrors[field] = errors[0];
      }
      return fail({
        code: ErrorCode.VALIDATION_FAILED,
        message: "输入校验失败，请检查各字段",
        fieldErrors,
      });
    }

    const data = parsed.data;
    const normalizedEmail = normalizeEmail(data.email);
    if (normalizedEmail !== normalizeEmail(session.email)) {
      return fail({
        code: ErrorCode.FORBIDDEN,
        message: "报名邮箱必须与登录邮箱一致",
      });
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, session.userId),
    });
    if (!user) {
      return fail({
        code: ErrorCode.UNAUTHORIZED,
        message: "账号数据异常，请重新登录后再报名",
      });
    }

    const existing = await db.query.seasonRegistrations.findFirst({
      where: and(
        eq(seasonRegistrations.userId, user.id),
        eq(seasonRegistrations.seasonId, data.seasonId)
      ),
    });
    if (existing) {
      throw new AppError(ErrorCode.REGISTRATION_DUPLICATE, ERROR_MESSAGES.REGISTRATION_DUPLICATE);
    }

    const [totalCount] = await db
      .select({ count: count() })
      .from(seasonRegistrations)
      .where(
        and(
          eq(seasonRegistrations.seasonId, data.seasonId),
          eq(seasonRegistrations.status, "approved"),
        ),
      );
    if (Number(totalCount?.count ?? 0) >= registrationConfig.maxTotal) {
      throw new AppError(ErrorCode.REGISTRATION_FULL, ERROR_MESSAGES.REGISTRATION_FULL);
    }

    const [posCount] = await db
      .select({ count: count() })
      .from(seasonRegistrations)
      .where(
        and(
          eq(seasonRegistrations.seasonId, data.seasonId),
          eq(seasonRegistrations.primaryPosition, data.primaryPosition)
        )
      );
    if (Number(posCount?.count ?? 0) >= registrationConfig.maxPerPosition) {
      throw new AppError(ErrorCode.POSITION_FULL, ERROR_MESSAGES.POSITION_FULL);
    }

    // 更新用户资料，首次报名或更换 steam 账号时刷新头像缓存；steam64 为空时清除旧头像
    const steamChanged = user.steam64 !== data.steam64;
    const avatarUrl = !steamChanged
      ? user.avatarUrl
      : (data.steam64 ? (await getSteamAvatar(data.steam64)) ?? null : null);

    const [updatedUser] = await db
      .update(users)
      .set({
        steam64: data.steam64,
        qq: data.qq,
        studentId: data.studentId,
        perfectName: data.perfectName,
        steamName: data.steamName,
        steamProfileUrl: data.steamProfileUrl,
        avatarUrl: avatarUrl ?? undefined,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id))
      .returning();

    if (!updatedUser) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, ERROR_MESSAGES.INTERNAL_ERROR);
    }

    const [registration] = await db
      .insert(seasonRegistrations)
      .values({
        userId: user.id,
        seasonId: data.seasonId,
        playerType: data.playerType,
        primaryPosition: data.primaryPosition,
        secondaryPosition: data.secondaryPosition,
        peakRank: data.peakRank,
        peakRankSeason: data.peakRankSeason,
        peakRating: data.peakRating,
        peakWe: data.peakWe,
        currentSeasonPeakRank: data.currentSeasonPeakRank,
        currentRating: data.currentRating,
        currentWe: data.currentWe,
        screenshotUrls: data.screenshotUrls,
        mapPreferences: data.mapPreferences,
        gameplayStyle: data.gameplayStyle,
        competitionHistory: data.competitionHistory,
        highlightVideoUrl: data.highlightVideoUrl,
        willingToBeCaptain: data.willingToBeCaptain,
        notes: data.notes,
      })
      .returning();

    await db
      .delete(registrationDrafts)
      .where(
        and(
          eq(registrationDrafts.seasonId, data.seasonId),
          eq(registrationDrafts.email, normalizedEmail),
        ),
      );

    await db.insert(auditLogs).values({
      seasonId: data.seasonId,
      action: "registration.submit",
      actorId: session.userId,
      targetId: registration.id,
      targetType: "registration",
      meta: { email: data.email, primaryPosition: data.primaryPosition },
    });

    revalidatePath(`/${season.slug}/register`);
    return ok({ registrationId: registration.id, email: data.email });
  } catch (e) {
    return actionError("submitRegistration", e);
  }
}

/**
 * 查询某赛季各位置当前报名人数
 */
export async function getPositionCounts(
  seasonId: string
): Promise<Record<string, number>> {
  const rows = await db
    .select({
      position: seasonRegistrations.primaryPosition,
      count: count(),
    })
    .from(seasonRegistrations)
    .where(eq(seasonRegistrations.seasonId, seasonId))
    .groupBy(seasonRegistrations.primaryPosition);

  return Object.fromEntries(rows.map((r) => [r.position, Number(r.count)]));
}

export async function getApprovedCount(seasonId: string): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(seasonRegistrations)
    .where(
      and(
        eq(seasonRegistrations.seasonId, seasonId),
        eq(seasonRegistrations.status, "approved"),
      ),
    );
  return Number(row?.count ?? 0);
}
