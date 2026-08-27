"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { users, auditLogs } from "@/db/schema";
import { createServiceClient } from "@/lib/auth/supabase";
import { requireAuth } from "@/lib/auth/session";
import { ok, fail, type ActionResult } from "@/types/action";
import { failValidation, actionError } from "@/lib/action-utils";
import { AppError, ErrorCode } from "@/lib/errors";
import { MIN_PASSWORD_LENGTH } from "@/lib/config/auth-config";

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

    await db.insert(auditLogs).values({
      seasonId: null,
      action: "user.change_password",
      actorId: session.userId,
      targetId: session.userId,
      targetType: "user",
    });

    return ok(undefined);
  } catch (e) {
    return actionError("changeUserPassword", e);
  }
}

/** 修改自定义昵称（2-20 字符） */
export async function updateDisplayName(
  displayName: string,
): Promise<ActionResult<void>> {
  const trimmed = displayName.trim();
  if (trimmed.length < 2) return failValidation("昵称至少 2 个字符");
  if (trimmed.length > 20) return failValidation("昵称最多 20 个字符");

  try {
    const session = await requireAuth();

    await db
      .update(users)
      .set({ displayName: trimmed, updatedAt: new Date() })
      .where(eq(users.id, session.userId));

    revalidatePath("/settings");
    return ok(undefined);
  } catch (e) {
    return actionError("updateDisplayName", e);
  }
}

export interface ProfileInput {
  displayName: string;
  steamName: string;
  perfectName: string;
  perfectId: string;
  steam64: string;
  steamProfileUrl: string;
  qq: string;
}

/** 更新个人信息（跨赛季字段） */
export async function updateProfile(
  input: ProfileInput,
): Promise<ActionResult<void>> {
  const displayName = input.displayName.trim();
  if (displayName.length < 2) return failValidation("昵称至少 2 个字符");
  if (displayName.length > 20) return failValidation("昵称最多 20 个字符");

  const steamName = input.steamName.trim();
  if (steamName && steamName.length > 40) return failValidation("Steam 昵称最多 40 个字符");

  const perfectName = input.perfectName.trim();
  if (perfectName && perfectName.length > 40) return failValidation("完美平台昵称最多 40 个字符");

  const perfectId = input.perfectId.trim();
  if (perfectId.length > 128) return failValidation("完美平台 ID 最多 128 个字符");

  const steam64 = input.steam64.trim();
  if (steam64 && !/^\d{17}$/.test(steam64)) return failValidation("Steam64 ID 格式不正确（应为 17 位数字）");

  const steamProfileUrl = input.steamProfileUrl.trim();
  if (steamProfileUrl && !steamProfileUrl.startsWith("https://steamcommunity.com/")) {
    return failValidation("Steam 个人资料链接格式不正确");
  }

  const qq = input.qq.trim();
  if (qq && !/^\d{5,12}$/.test(qq)) return failValidation("QQ 号格式不正确");

  try {
    const session = await requireAuth();

    await db
      .update(users)
      .set({
        displayName,
        steamName: steamName || null,
        perfectName: perfectName || null,
        perfectId: perfectId || null,
        steam64: steam64 || null,
        steamProfileUrl: steamProfileUrl || null,
        qq: qq || null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, session.userId));

    revalidatePath("/settings");
    return ok(undefined);
  } catch (e) {
    return actionError("updateProfile", e);
  }
}
