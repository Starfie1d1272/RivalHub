"use server";

import { revalidatePath } from "next/cache";
import { eq, sql, type SQL } from "drizzle-orm";
import { createPublicAuthClient, createServiceClient } from "@/lib/auth/supabase";
import { db } from "@/db/client";
import { users, adminInvites, auditLogs } from "@/db/schema";
import { ok, fail } from "@/types/action";
import { ErrorCode } from "@/lib/errors";
import type { ActionResult } from "@/types/action";
import { actionError } from "@/lib/action-utils";
import { MIN_PASSWORD_LENGTH } from "@/lib/config/auth-config";
import { normalizeEmail } from "@/lib/utils/email";
import { bootstrapConfiguredOwnerInTx } from "@/lib/auth/owner-bootstrap";
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
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return fail({ code: ErrorCode.VALIDATION_FAILED, message: `密码至少 ${MIN_PASSWORD_LENGTH} 位` });
  }
  const normalizedEmail = normalizeEmail(email);

  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });

    if (error) {
      return fail({ code: ErrorCode.UNAUTHORIZED, message: "邮箱或密码错误" });
    }

    const userRow = await db.transaction(async (tx) => {
      // 同步 public.users（密码登录不走 callback，这里兜底 upsert）
      const [upsertedUser] = await tx
        .insert(users)
        .values({
          email: normalizedEmail,
          authId: data.user.id,
          role: "user",
          adminSeasonIds: [],
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: users.email,
          set: { authId: data.user.id, updatedAt: new Date() },
        })
        .returning();
      if (!upsertedUser) throw new Error("登录后无法同步用户账号");
      return bootstrapConfiguredOwnerInTx(tx, upsertedUser);
    });

    await createUserSession({
      userId: userRow.id,
      email: userRow.email,
      role: userRow.role,
      adminSeasonIds: userRow.adminSeasonIds,
      authSource: "user",
    });

    return ok({ email: normalizedEmail });
  } catch (e) {
    return actionError("loginWithPassword", e);
  }
}

export async function signUp(
  email: string,
  password: string,
  turnstileToken?: string,
  next?: string,
): Promise<ActionResult<{ email: string }>> {
  if (!email || !email.includes("@")) {
    return fail({ code: ErrorCode.VALIDATION_FAILED, message: "请输入有效的邮箱地址" });
  }
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return fail({ code: ErrorCode.VALIDATION_FAILED, message: `密码至少 ${MIN_PASSWORD_LENGTH} 位` });
  }
  const normalizedEmail = normalizeEmail(email);

  // Turnstile 验证码校验
  const secretKey = process.env.TURNSTILE_SECRET_KEY;
  if (secretKey) {
    if (!turnstileToken) {
      return fail({ code: ErrorCode.VALIDATION_FAILED, message: "请完成验证码校验" });
    }
    try {
      const verifyResult = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: secretKey, response: turnstileToken }),
      });
      const verifyData = await verifyResult.json() as {
        success: boolean;
        "error-codes"?: string[];
        hostname?: string;
        action?: string;
      };
      if (!verifyData.success) {
        console.error("[turnstile] siteverify failed", {
          errorCodes: verifyData["error-codes"] ?? [],
          hostname: verifyData.hostname ?? null,
          action: verifyData.action ?? null,
        });
        return fail({ code: ErrorCode.VALIDATION_FAILED, message: "验证码校验失败，请刷新后重试" });
      }
    } catch {
      return fail({ code: ErrorCode.INTERNAL_ERROR, message: "验证服务暂不可用，请稍后重试" });
    }
  }

  try {
    const supabase = createPublicAuthClient();
    const { data, error } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: { emailRedirectTo: callbackUrl("signup", next) },
    });

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
    await db
      .insert(users)
      .values({
        email: normalizedEmail,
        authId: data.user.id,
        role: "user",
        adminSeasonIds: [],
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: users.email,
        set: { authId: data.user.id, updatedAt: new Date() },
      })
      .returning();

    // Never establish an iron-session here: Auth confirmation is the only
    // path that can create a session for a newly registered account.
    return ok({ email: normalizedEmail });
  } catch (e) {
    return actionError("signUp", e);
  }
}

/** Safe ambiguous resend endpoint for the signup waiting state. */
export async function resendSignupConfirmation(email: string, next?: string): Promise<ActionResult<void>> {
  if (!email || !email.includes("@")) return fail({ code: ErrorCode.VALIDATION_FAILED, message: "请输入有效的邮箱地址" });
  try {
    const { error } = await createPublicAuthClient().auth.resend({
      type: "signup",
      email: normalizeEmail(email),
      options: { emailRedirectTo: callbackUrl("signup", next) },
    });
    if (error && process.env.NODE_ENV === "development") console.warn("[resendSignupConfirmation]", error.message);
    return ok(undefined);
  } catch (e) { return actionError("resendSignupConfirmation", e); }
}

/** Existing accounts prove control of their already-bound email without account creation. */
export async function resendCurrentEmailVerification(): Promise<ActionResult<void>> {
  try {
    const session = await requireAuth();
    const user = await db.query.users.findFirst({ where: eq(users.id, session.userId) });
    if (!user) return fail({ code: ErrorCode.UNAUTHORIZED, message: "账号不存在，请重新登录。" });
    if (user.emailVerifiedAt) return ok(undefined);
    const { error } = await createServiceClient().auth.signInWithOtp({
      email: user.email,
      options: { shouldCreateUser: false, emailRedirectTo: callbackUrl("reverify") },
    });
    if (error) return fail({ code: ErrorCode.INTERNAL_ERROR, message: "验证邮件暂时无法发送，请稍后重试。" });
    return ok(undefined);
  } catch (e) { return actionError("resendCurrentEmailVerification", e); }
}

function callbackUrl(flow: "signup" | "reverify", next?: string): string {
  const origin = process.env.NEXT_PUBLIC_APP_URL;
  if (!origin) throw new Error("NEXT_PUBLIC_APP_URL 未配置");
  const url = new URL(`/auth/callback/${flow}`, origin);
  const safeNext = safeNextPath(next);
  if (safeNext) url.searchParams.set("next", safeNext);
  return url.toString();
}

function safeNextPath(next: string | undefined): string | null {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : null;
}

export async function sendPasswordResetEmail(email: string): Promise<ActionResult<undefined>> {
  if (!email || !email.includes("@")) {
    return fail({ code: ErrorCode.VALIDATION_FAILED, message: "请输入有效的邮箱地址" });
  }
  const normalizedEmail = normalizeEmail(email);

  try {
    const supabase = createServiceClient();
    const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/reset-password`,
    });

    if (error) {
      // 不暴露邮箱是否存在（防枚举），统一返回成功提示
      if (process.env.NODE_ENV === "development") {
        console.warn("[sendPasswordResetEmail]", error.message);
      }
    }
    return ok(undefined);
  } catch (e) {
    return actionError("sendPasswordResetEmail", e);
  }
}

export async function logoutUser(): Promise<ActionResult<undefined>> {
  try {
    await destroyUserSession();
    await destroyAdminSession();
    return ok(undefined);
  } catch (e) {
    return actionError("logoutUser", e);
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

      if (!updatedUser) {
        return fail({
          code: ErrorCode.UNAUTHORIZED,
          message: "账号不存在，请重新登录后重试",
        });
      }

      await tx
        .update(adminInvites)
        .set({
          usedCount: invite.usedCount + 1,
          isActive: invite.usedCount + 1 >= invite.maxUses ? false : invite.isActive,
          usedByUsernames: sql`array_append(${adminInvites.usedByUsernames}, ${session.email})`,
        })
        .where(eq(adminInvites.id, invite.id));

      await tx.insert(auditLogs).values({
        seasonId: invite.seasonId,
        action: "user.claim_invite",
        actorId: session.userId,
        targetId: session.userId,
        targetType: "user",
        meta: { inviteId: invite.id, newRole, email: session.email },
      });

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
    return actionError("claimInviteCode", e);
  }
}
