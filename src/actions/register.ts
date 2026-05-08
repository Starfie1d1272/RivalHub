"use server";

import { revalidatePath } from "next/cache";
import { eq, and, count } from "drizzle-orm";
import { db } from "@/db/client";
import { users, seasons, seasonRegistrations } from "@/db/schema";
import { ok, fail } from "@/types/action";
import { AppError, ErrorCode, ERROR_MESSAGES } from "@/lib/errors";
import {
  registrationSchema,
  MAX_PER_POSITION,
  type RegistrationFormData,
} from "@/lib/validators/registration";
import { createServiceClient } from "@/lib/auth/supabase";

/**
 * 提交报名
 * 1. Zod 校验
 * 2. 检查赛季存在且状态为 registration
 * 3. Upsert 用户（按 email）
 * 4. 检查是否重复报名
 * 5. 检查位置名额
 * 6. 插入报名记录
 * 7. 发送 Magic Link 邮件（非关键，失败不影响报名）
 */
export async function submitRegistration(input: RegistrationFormData) {
  // 1. 校验
  const parsed = registrationSchema.safeParse(input);
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

  try {
    // 2. 查赛季
    const season = await db.query.seasons.findFirst({
      where: eq(seasons.id, data.seasonId),
    });
    if (!season) {
      throw new AppError(ErrorCode.SEASON_NOT_FOUND, ERROR_MESSAGES.SEASON_NOT_FOUND);
    }
    if (season.status !== "registration") {
      throw new AppError(ErrorCode.REGISTRATION_CLOSED, ERROR_MESSAGES.REGISTRATION_CLOSED);
    }

    // 3. Upsert 用户（含所有基础信息字段）
    let user = await db.query.users.findFirst({
      where: eq(users.email, data.email),
    });
    const userFields = {
      steam64: data.steam64,
      qq: data.qq,
      studentId: data.studentId,
      perfectId: data.perfectId,
      steamName: data.steamName,
      steamProfileUrl: data.steamProfileUrl,
    };

    if (!user) {
      const [created] = await db
        .insert(users)
        .values({ email: data.email, ...userFields })
        .returning();
      user = created;
    } else {
      await db
        .update(users)
        .set({ ...userFields, updatedAt: new Date() })
        .where(eq(users.id, user.id));
    }

    // 4. 重复报名检查
    const existing = await db.query.seasonRegistrations.findFirst({
      where: and(
        eq(seasonRegistrations.userId, user.id),
        eq(seasonRegistrations.seasonId, data.seasonId)
      ),
    });
    if (existing) {
      throw new AppError(ErrorCode.REGISTRATION_DUPLICATE, ERROR_MESSAGES.REGISTRATION_DUPLICATE);
    }

    // 5. 位置名额检查
    const [posCount] = await db
      .select({ count: count() })
      .from(seasonRegistrations)
      .where(
        and(
          eq(seasonRegistrations.seasonId, data.seasonId),
          eq(seasonRegistrations.primaryPosition, data.primaryPosition)
        )
      );
    if (Number(posCount?.count ?? 0) >= MAX_PER_POSITION) {
      throw new AppError(ErrorCode.POSITION_FULL, ERROR_MESSAGES.POSITION_FULL);
    }

    // 6. 插入报名记录
    const screenshotUrls = [data.screenshotUrl];

    const [registration] = await db
      .insert(seasonRegistrations)
      .values({
        userId: user.id,
        seasonId: data.seasonId,
        primaryPosition: data.primaryPosition,
        secondaryPosition: data.secondaryPosition,
        peakRank: data.peakRank,
        peakRankSeason: data.peakRankSeason,
        peakRating: data.peakRating,
        peakWe: data.peakWe,
        currentSeasonPeakRank: data.currentSeasonPeakRank,
        currentRating: data.currentRating,
        currentWe: data.currentWe,
        screenshotUrls,
        gameplayStyle: data.gameplayStyle,
        competitionHistory: data.competitionHistory,
        highlightVideoUrl: data.highlightVideoUrl,
        willingToBeCaptain: data.willingToBeCaptain,
        notes: data.notes,
      })
      .returning();

    // 7. 发送 Magic Link（失败不阻断报名）
    try {
      const supabase = createServiceClient();
      await supabase.auth.signInWithOtp({
        email: data.email,
        options: { shouldCreateUser: true },
      });
    } catch (mailErr) {
      console.warn("[submitRegistration] magic link failed:", mailErr);
    }

    revalidatePath(`/${season.slug}/register`);
    return ok({ registrationId: registration.id, email: data.email });
  } catch (e) {
    if (e instanceof AppError) {
      return fail({ code: e.code, message: e.message });
    }
    console.error("[submitRegistration]", e);
    return fail({ code: ErrorCode.INTERNAL_ERROR, message: ERROR_MESSAGES.INTERNAL_ERROR });
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
