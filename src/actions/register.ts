"use server";

import { revalidatePath } from "next/cache";
import { eq, and, count } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { users, seasons, seasonRegistrations, registrationDrafts } from "@/db/schema";
import { ok, fail } from "@/types/action";
import { AppError, ErrorCode, ERROR_MESSAGES } from "@/lib/errors";
import { actionError } from "@/lib/action-utils";
import { createServiceClient } from "@/lib/auth/supabase";
import { createUserSession, getUserSession } from "@/lib/auth/session";
import { buildRegistrationSchema, registrationSeedSchema, type RegistrationFormData } from "@/lib/validators/registration";
import { normalizeRegistrationConfig } from "@/types/season";
import { getRegistrationWindowState } from "@/lib/registration/window";
import { normalizeEmail } from "@/lib/utils/email";
import { compactUndefined } from "@/lib/utils/object";

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
 * 提交报名
 * 1. Zod 校验
 * 2. 检查赛季存在且状态为 registration
 * 3. Upsert 用户（按 email）
 * 4. 检查是否重复报名
 * 5. 检查全局总报名人数上限
 * 6. 检查位置名额
 * 7. 插入报名记录
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
    // 2. 查赛季
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
    const registrationConfig = normalizeRegistrationConfig(season.registrationConfig);
    const parsed = buildRegistrationSchema(registrationConfig, season.positions, {
      requirePassword: !session,
    }).safeParse(input);
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
    if (session && normalizedEmail !== normalizeEmail(session.email)) {
      return fail({
        code: ErrorCode.FORBIDDEN,
        message: "已登录报名只能使用当前登录邮箱",
      });
    }

    // 3. 查找用户，后续在名额校验通过后再创建/绑定 Auth
    let user = session
      ? await db.query.users.findFirst({ where: eq(users.id, session.userId) })
      : await db.query.users.findFirst({ where: eq(users.email, normalizedEmail) });
    if (session && !user) {
      return fail({
        code: ErrorCode.UNAUTHORIZED,
        message: "登录状态异常，请重新登录后再报名",
      });
    }
    const userFields = {
      steam64: data.steam64,
      qq: data.qq,
      studentId: data.studentId,
      perfectName: data.perfectName,
      steamName: data.steamName,
      steamProfileUrl: data.steamProfileUrl,
    };

    // 4. 重复报名检查
    if (user) {
      const existing = await db.query.seasonRegistrations.findFirst({
        where: and(
          eq(seasonRegistrations.userId, user.id),
          eq(seasonRegistrations.seasonId, data.seasonId)
        ),
      });
      if (existing) {
        throw new AppError(ErrorCode.REGISTRATION_DUPLICATE, ERROR_MESSAGES.REGISTRATION_DUPLICATE);
      }
    }

    let shouldCreateUserSession = false;
    if (!session && user?.authId) {
      const supabase = createServiceClient();
      const { data: authData, error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password: data.password,
      });
      if (error || authData.user?.id !== user.authId) {
        return fail({
          code: ErrorCode.UNAUTHORIZED,
          message: "此邮箱已注册，请输入正确密码后再提交报名",
        });
      }
      shouldCreateUserSession = true;
    }

    // 5. 全局总报名人数上限检查（仅统计已通过，被拒/候补不占名额）
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

    // 6a. 事务插入报名记录
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

    // 6b. 创建或复用 Supabase Auth 账号
    let authId = user?.authId ?? null;
    if (!authId && session) {
      return fail({
        code: ErrorCode.UNAUTHORIZED,
        message: "账号尚未完成登录绑定，请重新注册或联系管理员",
      });
    }

    if (!authId) {
      const supabase = createServiceClient();
      const { data: authData, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password: data.password,
      });

      if (error || !authData.user) {
        return fail({
          code: ErrorCode.VALIDATION_FAILED,
          message: "账号创建失败，请确认邮箱和密码后重试",
        });
      }

      authId = authData.user.id;
      shouldCreateUserSession = true;
    }

    if (!user) {
      const [created] = await db
        .insert(users)
        .values({ email: normalizedEmail, authId, ...userFields })
        .returning();
      user = created;
    } else {
      const [updated] = await db
        .update(users)
        .set({ authId, ...userFields, updatedAt: new Date() })
        .where(eq(users.id, user.id))
        .returning();
      user = updated;
    }

    if (!user) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, ERROR_MESSAGES.INTERNAL_ERROR);
    }

    // 6. 插入报名记录
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

    if (shouldCreateUserSession) {
      await createUserSession({
        userId: user.id,
        email: user.email,
        role: user.role,
        adminSeasonIds: user.adminSeasonIds,
        authSource: "user",
      });
    }

    revalidatePath(`/${season.slug}/register`);
    return ok({ registrationId: registration.id, email: data.email });
  } catch (e) {
    return actionError("submitRegistration", e);
  }
}

/**
 * 查询某赛季各位置当前报名人数
 * 用于表单页展示名额余量
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

/** 查询某赛季已通过审批的总人数 */
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
