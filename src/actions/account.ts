"use server";

import { writeAuditInTx } from "@/lib/audit/write";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { createServiceClient } from "@/lib/auth/supabase-server";
import { requireAuth } from "@/lib/auth/session";
import { ok, fail, type ActionResult } from "@/types/action";
import { failValidation, actionError, isPgUniqueViolation } from "@/lib/action-utils";
import { AppError, ErrorCode } from "@/lib/errors";
import { MIN_PASSWORD_LENGTH } from "@/lib/config/auth-config";
import { isHttpUrl } from "@/lib/external-url";
import { normalizePlayerDeclaredProfile, playerDeclaredProfileSchema } from "@/lib/player-declared-profile";
import { updatePublicPlayerTag } from "@/lib/revalidation";
import { changePrimarySteam64InTx, assertSteam64Available, findSteam64Conflict } from "@/lib/identity/gameplay-steam";
import { getSteamProfileForPrimary, lookupAndCacheSteamProfile, upsertSteamProfile, type SteamProfileLookupResult } from "@/lib/steam-profiles";

export async function changeUserPassword(
  oldPassword: string,
  newPassword: string,
): Promise<ActionResult<void>> {
  if (!oldPassword) return failValidation("请输入原密码");
  if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) return failValidation(`新密码至少 ${MIN_PASSWORD_LENGTH} 位`);
  if (oldPassword === newPassword) return failValidation("新密码不能与原密码相同");

  try {
    const session = await requireAuth();
    const supabase = createServiceClient();

    const [{ error: signInError }, userRow] = await Promise.all([
      supabase.auth.signInWithPassword({ email: session.email, password: oldPassword }),
      db.query.users.findFirst({ where: eq(users.id, session.userId), columns: { authId: true } }),
    ]);

    if (signInError) {
      return fail({ code: ErrorCode.UNAUTHORIZED, message: "原密码错误" });
    }
    if (!userRow?.authId) {
      throw new AppError(ErrorCode.NOT_FOUND, "用户不存在");
    }

    const { error: updateError } = await supabase.auth.admin.updateUserById(
      userRow.authId,
      { password: newPassword },
    );
    if (updateError) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, "密码更新失败，请重试");
    }

    await writeAuditInTx(db, {
      seasonId: null,
      action: "user.change_password",
      actorId: session.userId,
      targetId: session.userId,});

    return ok(undefined);
  } catch (e) {
    return actionError("changeUserPassword", e);
  }
}

export interface ProfileInput {
  displayName: string;
  perfectName: string;
  steam64: string;
  qq: string;
  liveStreamUrl?: string;
  gameplayStyle?: string | null;
  competitionHistory?: string | null;
}

/** 更新个人信息（跨赛季字段） */
export async function updateProfile(
  input: ProfileInput,
): Promise<ActionResult<void>> {
  const displayName = input.displayName.trim();
  if (displayName.length < 2) return failValidation("昵称至少 2 个字符");
  if (displayName.length > 20) return failValidation("昵称最多 20 个字符");

  const perfectName = input.perfectName.trim();
  if (perfectName && perfectName.length > 40) return failValidation("完美平台昵称最多 40 个字符");

  const steam64 = input.steam64.trim();
  if (steam64 && !/^\d{17}$/.test(steam64)) return failValidation("Steam64 ID 格式不正确（应为 17 位数字）");

  const qq = input.qq.trim();
  if (qq && !/^\d{5,12}$/.test(qq)) return failValidation("QQ 号格式不正确");
  const liveStreamUrl = input.liveStreamUrl?.trim() ?? "";
  if (liveStreamUrl && !isHttpUrl(liveStreamUrl)) return failValidation("直播间链接必须是合法的 http 或 https URL");

  const declaredProfile = playerDeclaredProfileSchema.safeParse({
    gameplayStyle: input.gameplayStyle ?? "",
    competitionHistory: input.competitionHistory ?? "",
  });
  if (!declaredProfile.success) {
    return failValidation(declaredProfile.error.issues[0]?.message ?? "选手自述格式不正确");
  }
  const normalizedDeclaredProfile = normalizePlayerDeclaredProfile(declaredProfile.data);
  const declaredProfileUpdate = {
    ...(input.gameplayStyle !== undefined ? { gameplayStyle: normalizedDeclaredProfile.gameplayStyle } : {}),
    ...(input.competitionHistory !== undefined ? { competitionHistory: normalizedDeclaredProfile.competitionHistory } : {}),
  };

  try {
    const session = await requireAuth();

    const currentUser = await db.query.users.findFirst({ where: eq(users.id, session.userId) });
    if (!currentUser) return failValidation("用户资料不存在");

    const nextSteam64 = steam64 || null;
    let profile = null;
    if (nextSteam64) {
      await assertSteam64Available(db, nextSteam64, session.userId);
      profile = await getSteamProfileForPrimary(db, currentUser.steam64, nextSteam64);
    }

    await db.transaction(async (tx) => {
      await changePrimarySteam64InTx(tx, {
        userId: session.userId,
        nextSteam64,
        actorId: session.userId,
      });
      if (profile) await upsertSteamProfile(tx, profile);
      await tx
        .update(users)
        .set({
          displayName,
          perfectName: perfectName || null,
          qq: qq || null,
          liveStreamUrl: liveStreamUrl || null,
          ...declaredProfileUpdate,
          updatedAt: new Date(),
        })
        .where(eq(users.id, session.userId));
    });

    updatePublicPlayerTag(session.userId);
    revalidatePath("/settings");
    return ok(undefined);
  } catch (e) {
    if (isPgUniqueViolation(e, ["users_active_steam64_unique", "user_gameplay_steam_ids_active_steam64_unique"])) {
      return fail({ code: ErrorCode.STEAM_PROFILE_CONFLICT, message: "该 Steam64 ID 已关联其他账户，请联系管理员处理。" });
    }
    return actionError("updateProfile", e);
  }
}

/** 查询并缓存一份官方 Steam 资料；只返回用户可安全看到的投影。 */
export async function lookupSteamProfile(steam64Input: string): Promise<ActionResult<SteamProfileLookupResult>> {
  const steam64 = steam64Input.trim();
  if (!/^\d{17}$/.test(steam64)) return failValidation("Steam64 ID 格式不正确（应为 17 位数字）");

  try {
    const session = await requireAuth();
    if (await findSteam64Conflict(db, steam64, session.userId)) {
      return ok({ status: "conflict" });
    }
    return ok(await lookupAndCacheSteamProfile(db, steam64));
  } catch (e) {
    return actionError("lookupSteamProfile", e);
  }
}
