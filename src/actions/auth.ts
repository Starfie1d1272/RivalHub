"use server";

import { revalidatePath } from "next/cache";
import { eq, sql, type SQL } from "drizzle-orm";
import { createServiceClient } from "@/lib/auth/supabase";
import { db } from "@/db/client";
import { users } from "@/db/schema/users";
import { adminInvites } from "@/db/schema/admin-invites";
import { ok, fail } from "@/types/action";
import { ErrorCode } from "@/lib/errors";
import type { ActionResult } from "@/types/action";
import {
  requireAuth,
  createUserSession,
  destroyAdminSession,
  destroyUserSession,
} from "@/lib/auth/session";

export async function loginWithPassword(
  email: string,
  password: string,
): Promise<ActionResult<{ email: string }>> {
  if (!email || !email.includes("@")) {
    return fail({ code: ErrorCode.VALIDATION_FAILED, message: "请输入有效的邮箱地址" });
  }
  if (!password || password.length < 6) {
    return fail({ code: ErrorCode.VALIDATION_FAILED, message: "密码至少 6 位" });
  }

  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      return fail({ code: ErrorCode.UNAUTHORIZED, message: "邮箱或密码错误" });
    }

    // 同步 public.users（密码登录不走 callback，这里兜底 upsert）
    const [userRow] = await db
      .insert(users)
      .values({ id: data.user.id, email, role: "user", adminSeasonIds: [], updatedAt: new Date() })
      .onConflictDoUpdate({
        target: users.id,
        set: { updatedAt: new Date() },
      })
      .returning();

    await createUserSession({
      userId: userRow.id,
      email: userRow.email,
      role: userRow.role,
      adminSeasonIds: userRow.adminSeasonIds,
      authSource: "user",
    });

    return ok({ email });
  } catch (e) {
    console.error("[loginWithPassword]", e);
    return fail({ code: ErrorCode.INTERNAL_ERROR, message: "登录失败，请稍后重试" });
  }
}

export async function signUp(
  email: string,
  password: string,
): Promise<ActionResult<{ email: string }>> {
  if (!email || !email.includes("@")) {
    return fail({ code: ErrorCode.VALIDATION_FAILED, message: "请输入有效的邮箱地址" });
  }
  if (!password || password.length < 6) {
    return fail({ code: ErrorCode.VALIDATION_FAILED, message: "密码至少 6 位" });
  }

  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase.auth.signUp({ email, password });

    if (error) {
      // 不暴露邮箱是否已注册（防枚举），统一返回模糊提示。
      // Supabase signUp 在邮箱重复时返回 "already registered"，此处消费但不透传。
      return fail({ code: ErrorCode.VALIDATION_FAILED, message: "注册失败，请确认信息后重试" });
    }

    if (!data.user) {
      return fail({ code: ErrorCode.INTERNAL_ERROR, message: "注册失败，请稍后重试" });
    }

    // 事务保护：auth.users 行已创建，若 public.users 插入失败则回滚会话。
    // 极端情况下（DB 断开）auth.users 会遗留孤立行，下次登录时 loginWithPassword
    // 的 upsert 兜底修复，属于可接受的低概率不一致。
    const [userRow] = await db
      .insert(users)
      .values({ id: data.user.id, email, role: "user", adminSeasonIds: [], updatedAt: new Date() })
      .returning();

    await createUserSession({
      userId: userRow.id,
      email: userRow.email,
      role: userRow.role,
      adminSeasonIds: userRow.adminSeasonIds,
      authSource: "user",
    });

    return ok({ email });
  } catch (e) {
    console.error("[signUp]", e);
    return fail({ code: ErrorCode.INTERNAL_ERROR, message: "注册失败，请稍后重试" });
  }
}

export async function logoutUser(): Promise<ActionResult<undefined>> {
  try {
    await destroyUserSession();
    await destroyAdminSession();
    return ok(undefined);
  } catch (e) {
    console.error("[logoutUser]", e);
    return fail({ code: ErrorCode.INTERNAL_ERROR, message: "退出失败，请稍后重试" });
  }
}

export async function claimInviteCode(code: string): Promise<ActionResult<{ role: string }>> {
  if (!code || code.trim() === "") {
    return fail({ code: ErrorCode.VALIDATION_FAILED, message: "请输入邀请码" });
  }

  const session = await requireAuth();

  try {
    const result = await db.transaction(async (tx) => {
      const invite = await tx.query.adminInvites.findFirst({
        where: eq(adminInvites.code, code.trim()),
      });

      if (!invite) {
        return fail({ code: ErrorCode.UNAUTHORIZED, message: "邀请码无效" });
      }
      if (!invite.isActive) {
        return fail({ code: ErrorCode.UNAUTHORIZED, message: "邀请码已失效" });
      }
      if (invite.usedCount >= invite.maxUses) {
        return fail({ code: ErrorCode.UNAUTHORIZED, message: "邀请码已用完" });
      }
      if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
        return fail({ code: ErrorCode.UNAUTHORIZED, message: "邀请码已过期" });
      }
      if (invite.role === "admin" && !invite.seasonId) {
        return fail({ code: ErrorCode.VALIDATION_FAILED, message: "赛季管理员邀请码缺少赛季范围" });
      }

      const targetRole = invite.role === "super_admin" ? "super_admin" : "season_admin";
      // 已有 super_admin 的用户不会被降级
      const newRole = session.role === "super_admin" ? "super_admin" : targetRole;
      const updateSet: {
        role: "user" | "season_admin" | "super_admin";
        updatedAt: Date;
        adminSeasonIds?: SQL<unknown>;
      } = {
        role: newRole,
        updatedAt: new Date(),
      };

      if (newRole === "season_admin" && invite.seasonId) {
        updateSet.adminSeasonIds = sql`(
          SELECT ARRAY(
            SELECT DISTINCT unnest(array_append(${users.adminSeasonIds}, ${invite.seasonId}::uuid))
          )
        )`;
      }

      const [updatedUser] = await tx
        .update(users)
        .set(updateSet)
        .where(eq(users.id, session.userId))
        .returning();

      await tx
        .update(adminInvites)
        .set({
          usedCount: invite.usedCount + 1,
          isActive: invite.usedCount + 1 >= invite.maxUses ? false : invite.isActive,
          usedByUsernames: sql`array_append(${adminInvites.usedByUsernames}, ${session.email})`,
        })
        .where(eq(adminInvites.id, invite.id));

      return ok({ updatedUser, newRole });
    });

    if (!result.success) return result;

    const { updatedUser, newRole } = result.data;

    await createUserSession({
      userId: updatedUser.id,
      email: updatedUser.email,
      role: updatedUser.role,
      adminSeasonIds: updatedUser.adminSeasonIds,
      authSource: "user",
    });

    revalidatePath("/admin");
    return ok({ role: newRole });
  } catch (e) {
    console.error("[claimInviteCode]", e);
    return fail({ code: ErrorCode.INTERNAL_ERROR, message: "提权失败，请稍后重试" });
  }
}
