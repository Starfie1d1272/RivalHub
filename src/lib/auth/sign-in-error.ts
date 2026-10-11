import "server-only";
import { fail, type ActionResult } from "@/types/action";
import { ErrorCode } from "@/lib/errors";
import { ensureRequestId } from "@/lib/observability/context";
import { logEvent } from "@/lib/observability/server";

/** Shared returned-SDK contract for login and current-password verification. */
export function signInFailure(error: { status?: unknown }, operation: "auth.sign_in" | "auth.verify_password"): ActionResult<never> {
  if (isAuthServerFailure(error.status)) return authServerFailure(operation, error.status);
  if (error.status === 429 || authErrorCode(error) === "over_request_rate_limit") return loginProviderFailure(error.status, true, operation);
  if (authErrorCode(error) === "email_not_confirmed") return fail({
    code: ErrorCode.EMAIL_NOT_CONFIRMED,
    message: "邮箱尚未验证，请先完成邮箱验证；若未收到邮件，请检查垃圾邮件或重新发送。",
  });
  if (authErrorCode(error) === "invalid_credentials") return fail({
    code: ErrorCode.UNAUTHORIZED,
    message: operation === "auth.verify_password" ? "原密码错误" : "邮箱或密码错误",
  });
  return loginProviderFailure(error.status, false, operation);
}

export function isAuthServerFailure(status: unknown): status is number {
  return typeof status === "number" && Number.isInteger(status) && status >= 500 && status <= 599;
}

function loginProviderFailure(status: unknown, rateLimited: boolean, operation: "auth.sign_in" | "auth.verify_password"): ActionResult<never> {
  const requestId = ensureRequestId();
  logEvent({
    level: rateLimited ? "info" : "error",
    event: rateLimited ? "auth.provider.rate_limited" : "auth.provider.login_unavailable",
    scope: "provider", operation,
    errorClass: rateLimited ? "expected" : "dependency", retryable: true, requestId,
    safeContext: { provider: "supabase-auth", ...(typeof status === "number" && Number.isInteger(status) && status >= 0 && status <= 599 ? { httpStatus: status } : {}) },
  });
  const message = rateLimited
    ? "登录请求过于频繁，请等待几分钟后再试；如仍有问题，请联系平台管理员。"
    : "暂时无法完成账号验证，请稍后重试；如仍有问题，请联系平台管理员。";
  return fail({ code: ErrorCode.INTERNAL_ERROR, requestId, message: `${message}排查编号：${requestId}` });
}

/** SDK-returned 5xx are dependency failures, never proof of invalid identity. */
export function authServerFailure(operation: "auth.sign_in" | "auth.sign_up" | "auth.verify_password", status: number): ActionResult<never> {
  const requestId = ensureRequestId();
  // Preserve authoritative HTTP status, not the provider body that may echo PII.
  logEvent({
    level: "error", event: "auth.provider.server_failure", scope: "provider", operation,
    errorClass: "dependency", errorCode: "AUTH_PROVIDER_SERVER_ERROR", retryable: true, requestId,
    safeContext: { provider: "supabase-auth", httpStatus: status },
  });
  const message = operation === "auth.sign_up"
    ? "账号服务暂时不可用，注册结果无法确认，请先检查验证邮件；如未收到，请稍后重试或联系管理员。"
    : "账号服务暂时不可用，请稍后重试；如仍有问题，请联系管理员。";
  return fail({ code: ErrorCode.INTERNAL_ERROR, requestId, message: `${message}排查编号：${requestId}` });
}

export function authErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}

