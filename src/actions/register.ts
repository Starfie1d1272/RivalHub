"use server";

import { writeAuditInTx } from "@/lib/audit/write";

import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { users, seasons, seasonRegistrations, registrationDrafts } from "@/db/schema";
import { ok, fail } from "@/types/action";
import { AppError, ErrorCode, ERROR_MESSAGES } from "@/lib/errors";
import { actionError } from "@/lib/action-utils";
import { getUserSession } from "@/lib/auth/session";
import {
  buildRegistrationSchema,
  registrationSeedSchema,
  type RegistrationFormData,
} from "@/lib/validators/registration";
import { normalizeRegistrationConfig } from "@/lib/seasons/compatibility";
import { getRegistrationWindowState } from "@/lib/registration/window";
import { getRegistrationCounts } from "@/lib/registration/counts";
import { normalizeEmail } from "@/lib/utils/email";
import { compactUndefined } from "@/lib/utils/object";
import { lockGameplayIdentityWriteInTx } from "@/lib/identity/write-lock";
import { changePrimarySteam64InTx, assertSteam64Available } from "@/lib/identity/gameplay-steam";
import { getSteamProfileForPrimary, upsertSteamProfile } from "@/lib/steam-profiles";
import { assertUsersNotBlockedInTx } from "@/lib/discipline/service";
import {
  updatePublicHomeTag,
  updatePublicPlayerTag,
  updatePublicSeasonTags,
} from "@/lib/revalidation";
import { normalizePlayerDeclaredProfile } from "@/lib/player-declared-profile";
import { ensureRegistrationOpenForParticipantInTx } from "@/lib/seasons/registration-recovery";

const draftSchema = z.object({
  seasonId: z.guid("赛季 ID 格式不正确"),
  email: z.string().email("请先填写有效邮箱"),
  payload: z.record(z.string(), z.unknown()).default({}),
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
    const session = await getUserSession();
    if (!session) {
      return fail({
        code: ErrorCode.UNAUTHORIZED,
        message: "请先登录或注册账号后再保存报名草稿",
      });
    }

    const email = normalizeEmail(parsed.data.email);
    if (email !== normalizeEmail(session.email)) {
      return fail({
        code: ErrorCode.FORBIDDEN,
        message: "只能保存当前登录账号的报名草稿",
      });
    }

    const season = await db.query.seasons.findFirst({
      where: eq(seasons.id, parsed.data.seasonId),
    });
    if (!season) {
      throw new AppError(ErrorCode.SEASON_NOT_FOUND, ERROR_MESSAGES.SEASON_NOT_FOUND);
    }
    const initialWindow = getRegistrationWindowState(season);
    if (!initialWindow.canSaveDraft && !initialWindow.needsOpeningRecovery) {
      throw new AppError(ErrorCode.REGISTRATION_CLOSED, initialWindow.message);
    }

    const payload = {
      ...(compactUndefined(parsed.data.payload) as Record<string, unknown>),
      seasonId: parsed.data.seasonId,
      email,
    };

    const current = await db.transaction(async (tx) => {
      const { season: materializedSeason, opened } = await ensureRegistrationOpenForParticipantInTx(
        tx,
        parsed.data.seasonId,
      );
      const windowState = getRegistrationWindowState(materializedSeason);
      if (!windowState.canSaveDraft) {
        throw new AppError(ErrorCode.REGISTRATION_CLOSED, windowState.message);
      }
      await tx
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
      return { season: materializedSeason, opened };
    });

    revalidatePath(`/${current.season.slug}/register`);
    if (current.opened) updatePublicSeasonTags(current.season.slug, current.season.id);
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
    const session = await getUserSession();
    if (!session) {
      return fail({
        code: ErrorCode.UNAUTHORIZED,
        message: "请先登录或注册账号后再加载报名草稿",
      });
    }

    const normalizedEmail = normalizeEmail(parsed.data.email);
    if (normalizedEmail !== normalizeEmail(session.email)) {
      return fail({
        code: ErrorCode.FORBIDDEN,
        message: "只能加载当前登录账号的报名草稿",
      });
    }

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
        eq(registrationDrafts.email, normalizedEmail),
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
  if (!seedParsed.success) return invalidRegistrationInput(seedParsed.error);

  try {
    let season = await db.query.seasons.findFirst({
      where: eq(seasons.id, seedParsed.data.seasonId),
    });
    if (!season) {
      throw new AppError(ErrorCode.SEASON_NOT_FOUND, ERROR_MESSAGES.SEASON_NOT_FOUND);
    }
    if (season.registrationMode !== "solo") {
      throw new AppError(
        ErrorCode.SEASON_CAPABILITY_DISABLED,
        "队伍报名尚未开放，请联系赛事管理员",
      );
    }
    const initialWindow = getRegistrationWindowState(season);
    if (!initialWindow.canSubmit && !initialWindow.needsOpeningRecovery) {
      throw new AppError(ErrorCode.REGISTRATION_CLOSED, initialWindow.message);
    }
    const session = await getUserSession();
    if (!session) {
      return fail({
        code: ErrorCode.UNAUTHORIZED,
        message: "请先登录或注册账号后再报名",
      });
    }

    // Materialize the same canonical opening fact before doing validation and
    // then repeat the gate inside the final mutation transaction below.
    const seasonId = season.id;
    if (initialWindow.needsOpeningRecovery) {
      const opening = await db.transaction((tx) =>
        ensureRegistrationOpenForParticipantInTx(tx, seasonId),
      );
      season = opening.season;
      if (opening.opened) updatePublicSeasonTags(season.slug, season.id);
    }
    const windowState = getRegistrationWindowState(season);
    if (!windowState.canSubmit) {
      throw new AppError(ErrorCode.REGISTRATION_CLOSED, windowState.message);
    }

    const registrationConfig = normalizeRegistrationConfig(season.registrationConfig);
    const parsed = buildRegistrationSchema(registrationConfig, season.positions).safeParse(input);
    if (!parsed.success) return invalidRegistrationInput(parsed.error);

    const initialData = parsed.data;
    const normalizedEmail = normalizeEmail(initialData.email);
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
    await assertSteam64Available(db, initialData.steam64, user.id);
    const steamProfile = await getSteamProfileForPrimary(db, user.steam64, initialData.steam64);

    const registration = await db.transaction(async (tx) => {
      await lockGameplayIdentityWriteInTx(tx);
      const { season: currentSeason, opened } = await ensureRegistrationOpenForParticipantInTx(
        tx,
        seasonId,
      );
      const currentWindow = getRegistrationWindowState(currentSeason);
      if (!currentWindow.canSubmit)
        throw new AppError(ErrorCode.REGISTRATION_CLOSED, currentWindow.message);
      if (currentSeason.registrationMode !== "solo") {
        throw new AppError(
          ErrorCode.SEASON_CAPABILITY_DISABLED,
          "队伍报名尚未开放，请联系赛事管理员",
        );
      }

      const currentConfig = normalizeRegistrationConfig(currentSeason.registrationConfig);
      const currentInput = buildRegistrationSchema(
        currentConfig,
        currentSeason.positions,
      ).safeParse(input);
      if (!currentInput.success)
        return { invalidInput: currentInput.error, opened, seasonSlug: currentSeason.slug };
      const data = currentInput.data;
      await assertUsersNotBlockedInTx(tx, {
        seasonId,
        userLabels: new Map([[user.id, user.email]]),
        effect: "registration_block",
        message: "当前账号处于报名禁赛期",
      });

      const existing = await tx.query.seasonRegistrations.findFirst({
        where: and(
          eq(seasonRegistrations.userId, user.id),
          eq(seasonRegistrations.seasonId, seasonId),
        ),
      });
      if (existing?.status === "approved") {
        throw new AppError(
          ErrorCode.REGISTRATION_DUPLICATE,
          "报名已审核通过，无法自行修改。如确需调整请联系管理员。",
        );
      }
      const { approvedCount, positionCounts } = await getRegistrationCounts(
        seasonId,
        tx,
        existing?.id,
      );
      if (!existing && approvedCount >= currentConfig.maxTotal) {
        throw new AppError(ErrorCode.REGISTRATION_FULL, ERROR_MESSAGES.REGISTRATION_FULL);
      }
      if ((positionCounts[data.primaryPosition] ?? 0) >= currentConfig.maxPerPosition) {
        throw new AppError(ErrorCode.POSITION_FULL, ERROR_MESSAGES.POSITION_FULL);
      }

      const declaredProfile = normalizePlayerDeclaredProfile(data);
      await changePrimarySteam64InTx(tx, {
        userId: user.id,
        nextSteam64: data.steam64,
        actorId: session.userId,
      });
      await upsertSteamProfile(tx, steamProfile);
      const [updatedUser] = await tx
        .update(users)
        .set({
          qq: data.qq,
          studentId: data.studentId,
          perfectName: data.perfectName,
          gameplayStyle: declaredProfile.gameplayStyle ?? data.gameplayStyle,
          competitionHistory: declaredProfile.competitionHistory,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id))
        .returning();

      if (!updatedUser) {
        throw new AppError(ErrorCode.INTERNAL_ERROR, ERROR_MESSAGES.INTERNAL_ERROR);
      }

      const registrationValues = {
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
        gameplayStyle: declaredProfile.gameplayStyle ?? data.gameplayStyle,
        competitionHistory: declaredProfile.competitionHistory,
        highlightVideoUrl: data.highlightVideoUrl,
        willingToBeCaptain: data.willingToBeCaptain,
        notes: data.notes,
      };

      const [savedRegistration] = existing
        ? await tx
            .update(seasonRegistrations)
            .set({
              ...registrationValues,
              status: "pending",
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(seasonRegistrations.id, existing.id),
                ne(seasonRegistrations.status, "approved"),
              ),
            )
            .returning()
        : await tx
            .insert(seasonRegistrations)
            .values({
              userId: user.id,
              seasonId: data.seasonId,
              ...registrationValues,
            })
            .returning();
      if (!savedRegistration)
        throw new AppError(ErrorCode.INTERNAL_ERROR, ERROR_MESSAGES.INTERNAL_ERROR);

      await tx
        .delete(registrationDrafts)
        .where(
          and(
            eq(registrationDrafts.seasonId, data.seasonId),
            eq(registrationDrafts.email, normalizedEmail),
          ),
        );

      await writeAuditInTx(tx, {
        seasonId: data.seasonId,
        action: "registration.submit",
        actorId: session.userId,
        targetId: savedRegistration.id,
        meta: { email: data.email, primaryPosition: data.primaryPosition },
      });

      return { registration: savedRegistration, seasonSlug: currentSeason.slug, opened };
    });

    if (registration.opened) updatePublicSeasonTags(registration.seasonSlug, seasonId);
    if (registration.invalidInput) return invalidRegistrationInput(registration.invalidInput);
    updatePublicPlayerTag(user.id);
    if (!registration.opened) updatePublicHomeTag();
    revalidatePath(`/${registration.seasonSlug}/register`);
    return ok({ registrationId: registration.registration.id, email: initialData.email });
  } catch (e) {
    return actionError("submitRegistration", e);
  }
}

function invalidRegistrationInput(error: z.ZodError) {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (typeof field === "string" && !fieldErrors[field]) fieldErrors[field] = issue.message;
  }
  return fail({
    code: ErrorCode.VALIDATION_FAILED,
    message: "输入校验失败，请检查各字段",
    fieldErrors,
  });
}
