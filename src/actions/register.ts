"use server";

import { revalidatePath } from "next/cache";
import { eq, and, count } from "drizzle-orm";
import { db } from "@/db/client";
import { users, seasons, seasonRegistrations } from "@/db/schema";
import { ok, fail } from "@/types/action";
import { AppError, ErrorCode, ERROR_MESSAGES } from "@/lib/errors";
import { actionError } from "@/lib/action-utils";
import { buildRegistrationSchema, registrationSeedSchema, type RegistrationFormData } from "@/lib/validators/registration";
import { normalizeRegistrationConfig } from "@/types/season";

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
    if (season.status !== "registration") {
      throw new AppError(ErrorCode.REGISTRATION_CLOSED, ERROR_MESSAGES.REGISTRATION_CLOSED);
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

    // 3. Upsert 用户（含所有基础信息字段）
    let user = await db.query.users.findFirst({
      where: eq(users.email, data.email),
    });
    const userFields = {
      steam64: data.steam64,
      qq: data.qq,
      studentId: data.studentId,
      perfectName: data.perfectName,
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

    // 5. 全局总报名人数上限检查
    const [totalCount] = await db
      .select({ count: count() })
      .from(seasonRegistrations)
      .where(eq(seasonRegistrations.seasonId, data.seasonId));
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
        gameplayStyle: data.gameplayStyle,
        competitionHistory: data.competitionHistory,
        highlightVideoUrl: data.highlightVideoUrl,
        willingToBeCaptain: data.willingToBeCaptain,
        notes: data.notes,
      })
      .returning();

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
