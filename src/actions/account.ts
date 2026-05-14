"use server";

import { eq } from "drizzle-orm";
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
