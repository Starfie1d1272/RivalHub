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

export async function sendMagicLink(email: string): Promise<ActionResult<{ email: string }>> {
  if (!email || !email.includes("@")) {
    return fail({ code: ErrorCode.VALIDATION_FAILED, message: "请输入有效的邮箱地址" });
  }

  try {
    const supabase = createServiceClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
      },
    });

    if (error) {
      // Supabase intentionally avoids account enumeration; keep UI response generic.
      console.warn("[sendMagicLink]", error.message);
    }

    return ok({ email });
  } catch (e) {
    console.error("[sendMagicLink]", e);
    return fail({ code: ErrorCode.INTERNAL_ERROR, message: "发送失败，请稍后重试" });
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
