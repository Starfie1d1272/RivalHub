"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { createPublicAuthClient, createServiceClient } from "@/lib/auth/supabase-server";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { ok, fail } from "@/types/action";
import { ErrorCode } from "@/lib/errors";
import type { ActionResult } from "@/types/action";
import { actionError } from "@/lib/action-utils";
import { MIN_PASSWORD_LENGTH, isPasswordPolicySatisfied, PASSWORD_POLICY_MESSAGE } from "@/lib/config/auth-config";
import { normalizeEmail } from "@/lib/utils/email";
import { safeLocalRedirect } from "@/lib/auth/redirect";
import { bootstrapConfiguredOwnerInTx } from "@/lib/auth/owner-bootstrap";
import {
  requireAuth,
  createUserSession,
  destroyUserSession,
} from "@/lib/auth/session";
import { claimAdminInviteInTx } from "@/lib/auth/admin-invites";
import { providerFetch } from "@/lib/observability/fetch";
import { captureException, logEvent, traceOperation } from "@/lib/observability/server";

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
    const { data, error } = await traceOperation("provider.supabase.auth.sign_in", {
      scope: "provider",
      operation: "auth.sign_in",
      provider: "supabase-auth",
    }, () => supabase.auth.signInWithPassword({ email: normalizedEmail, password }));

    if (error) {
      if (authErrorCode(error) === "email_not_confirmed") {
        return fail({
          code: ErrorCode.EMAIL_NOT_CONFIRMED,
          message: "邮箱尚未验证，请先完成邮箱验证；若未收到邮件，请检查垃圾邮件或重新发送。",
        });
      }
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
    });

    return ok({ email: normalizedEmail });
  } catch (e) {
    return actionError("loginWithPassword", e);
  }
}

export async function signUp(
  email: string,
  password: string,
  confirmPassword: string,
  turnstileToken?: string,
  next?: string,
): Promise<ActionResult<{ email: string }>> {
  if (!email || !email.includes("@")) {
    return fail({ code: ErrorCode.VALIDATION_FAILED, message: "请输入有效的邮箱地址" });
  }
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return fail({ code: ErrorCode.VALIDATION_FAILED, message: `密码至少 ${MIN_PASSWORD_LENGTH} 位` });
  }
  if (!isPasswordPolicySatisfied(password)) {
    return fail({ code: ErrorCode.VALIDATION_FAILED, message: PASSWORD_POLICY_MESSAGE });
  }
  if (password !== confirmPassword) {
    return fail({ code: ErrorCode.VALIDATION_FAILED, message: "两次输入的密码不一致" });
  }
  const normalizedEmail = normalizeEmail(email);

  // Turnstile 验证码校验
  const secretKey = process.env.TURNSTILE_SECRET_KEY;
  if (secretKey) {
    if (!turnstileToken) {
      return fail({ code: ErrorCode.VALIDATION_FAILED, message: "请完成验证码校验" });
    }
    try {
      const verifyResult = await traceOperation("provider.turnstile.verify", {
        scope: "provider",
        operation: "turnstile.verify",
        provider: "turnstile",
      }, () => providerFetch("turnstile")("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: secretKey, response: turnstileToken }),
      }));
      const verifyData = await verifyResult.json() as {
        success: boolean;
        "error-codes"?: string[];
        hostname?: string;
        action?: string;
      };
      if (!verifyData.success) {
        logEvent({
          level: "warn",
          event: "auth.turnstile.rejected",
          scope: "security",
          operation: "signup.turnstile",
          errorClass: "expected",
          safeContext: {
            errorCodes: (verifyData["error-codes"] ?? []).slice(0, 3),
            hostname: verifyData.hostname,
            action: verifyData.action,
          },
        });
        return fail({ code: ErrorCode.VALIDATION_FAILED, message: "验证码校验失败，请刷新后重试" });
      }
    } catch (error) {
      captureException("provider.turnstile.failure", error, {
        scope: "provider",
        operation: "turnstile.verify",
        errorClass: "dependency",
        retryable: true,
        safeContext: { provider: "turnstile" },
      });
      return fail({ code: ErrorCode.INTERNAL_ERROR, message: "验证服务暂不可用，请稍后重试" });
    }
  }

  try {
    const supabase = createPublicAuthClient();
    const { error } = await traceOperation("provider.supabase.auth.sign_up", {
      scope: "provider",
      operation: "auth.sign_up",
      provider: "supabase-auth",
    }, () => supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: { emailRedirectTo: confirmationUrl("signup", next) },
    }));

    if (error) {
      if (authErrorCode(error) === "over_email_send_rate_limit") {
        return emailSendFailure(error, "验证邮件");
      }
      // 不暴露邮箱是否已注册（防枚举），统一返回模糊提示。
      // Supabase signUp 在邮箱重复时返回 "already registered"，此处消费但不透传。
      return fail({ code: ErrorCode.VALIDATION_FAILED, message: "注册失败，请确认信息后重试" });
    }

    // Supabase may return an obfuscated user for a repeated signup. The
    // response id is therefore not proof of a canonical Auth identity.
    // Binding belongs only to the explicit confirmation or password-login
    // paths, and signup never creates an application session.
    return ok({ email: normalizedEmail });
  } catch (e) {
    return actionError("signUp", e);
  }
}

/** Safe ambiguous resend endpoint for the signup waiting state. */
export async function resendSignupConfirmation(email: string, next?: string): Promise<ActionResult<void>> {
  if (!email || !email.includes("@")) return fail({ code: ErrorCode.VALIDATION_FAILED, message: "请输入有效的邮箱地址" });
  try {
    const { error } = await traceOperation("provider.supabase.auth.resend", {
      scope: "provider",
      operation: "auth.resend",
      provider: "supabase-auth",
    }, () => createPublicAuthClient().auth.resend({
      type: "signup",
      email: normalizeEmail(email),
      options: { emailRedirectTo: confirmationUrl("signup", next) },
    }));
    if (error) return emailSendFailure(error, "验证邮件");
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
    const { error } = await traceOperation("provider.supabase.auth.reverify", {
      scope: "provider",
      operation: "auth.reverify",
      provider: "supabase-auth",
    }, () => createServiceClient().auth.signInWithOtp({
      email: user.email,
      options: { shouldCreateUser: false, emailRedirectTo: confirmationUrl("reverify") },
    }));
    if (error) return emailSendFailure(error, "验证邮件");
    return ok(undefined);
  } catch (e) { return actionError("resendCurrentEmailVerification", e); }
}

function confirmationUrl(flow: "signup" | "reverify", next?: string): string {
  const origin = process.env.NEXT_PUBLIC_APP_URL;
  if (!origin) throw new Error("NEXT_PUBLIC_APP_URL 未配置");
  const url = new URL("/auth/confirmation", origin);
  // Email templates append their token parameters with `&`. Keep this query
  // parameter even without `next`, otherwise a second `?` discards token_hash.
  url.searchParams.set("flow", flow);
  const safeNext = safeNextPath(next);
  if (safeNext) url.searchParams.set("next", safeNext);
  return url.toString();
}

function safeNextPath(next: string | undefined): string | null {
  const safeNext = safeLocalRedirect(next, "");
  return safeNext || null;
}

export async function sendPasswordResetEmail(email: string): Promise<ActionResult<undefined>> {
  if (!email || !email.includes("@")) {
    return fail({ code: ErrorCode.VALIDATION_FAILED, message: "请输入有效的邮箱地址" });
  }
  const normalizedEmail = normalizeEmail(email);

  try {
    const supabase = createServiceClient();
    const { error } = await traceOperation("provider.supabase.auth.password_reset", {
      scope: "provider",
      operation: "auth.password_reset",
      provider: "supabase-auth",
    }, () => supabase.auth.resetPasswordForEmail(normalizedEmail, {
      redirectTo: new URL("/reset-password", process.env.NEXT_PUBLIC_APP_URL).toString(),
    }));

    if (error) {
      // 不暴露邮箱是否存在（防枚举），但不能把真实的发信/配置失败伪装成成功。
      return emailSendFailure(error, "重置邮件");
    }
    return ok(undefined);
  } catch (e) {
    return actionError("sendPasswordResetEmail", e);
  }
}

function authErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}

function emailSendFailure(error: unknown, emailKind: "验证邮件" | "重置邮件"): ActionResult<never> {
  const providerCode = authErrorCode(error);
  if (providerCode === "over_email_send_rate_limit") {
    logEvent({
      level: "info",
      event: "auth.mail.rate_limited",
      scope: "provider",
      operation: "auth.mail_send",
      errorClass: "expected",
      retryable: true,
      safeContext: { provider: "supabase-auth", providerCode, kind: emailKind },
    });
    return fail({ code: ErrorCode.EMAIL_SEND_RATE_LIMITED, message: "邮件发送过于频繁，请稍后再试。" });
  }
  logEvent({
    level: "error",
    event: "auth.mail.provider_failure",
    scope: "provider",
    operation: "auth.mail_send",
    errorClass: "dependency",
    retryable: true,
    safeContext: { provider: "supabase-auth", providerCode: providerCode ?? "unknown", kind: emailKind },
  });
  return fail({ code: ErrorCode.INTERNAL_ERROR, message: `${emailKind}暂时无法发送，请稍后重试。` });
}

export async function logoutUser(): Promise<ActionResult<undefined>> {
  try {
    await destroyUserSession();
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
    const result = await db.transaction((tx) =>
      claimAdminInviteInTx(tx, {
        code: code.trim(),
        userId: session.userId,
      }),
    );

    await createUserSession({ userId: result.userId, email: result.email });

    revalidatePath("/admin");
    return ok({ role: result.role });
  } catch (e) {
    return actionError("claimInviteCode", e);
  }
}
