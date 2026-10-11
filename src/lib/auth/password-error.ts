import "server-only";
import { AppError, ErrorCode } from "@/lib/errors";

/** Fixed product guidance; raw provider diagnostics remain server-side only. */
export class PasswordMutationError extends AppError {
  constructor(public readonly outcome: "unknown" | "rejected", cause: unknown) {
    super(outcome === "unknown" ? ErrorCode.PASSWORD_UPDATE_OUTCOME_UNKNOWN : ErrorCode.INTERNAL_ERROR, outcome === "unknown"
      ? "密码更新结果暂时无法确认，登录已暂停。请勿重复提交或尝试新旧密码；请联系平台管理员，提供操作时间和排查编号，核对账号服务与安全审计后再恢复登录。"
      : "密码更新失败，旧登录已退出，请重新登录后重试。");
    this.cause = cause;
  }
}

export function passwordFailureStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  try {
    const status = Reflect.get(error, "status");
    return typeof status === "number" && Number.isInteger(status) && status >= 0 && status <= 599 ? status : undefined;
  } catch { return undefined; }
}

/** Credential endpoints can echo arbitrary inputs: never log message/stack/body. */
export function passwordFailureCause(error: unknown): object {
  const seen = new Set<object>();
  function project(value: unknown, depth: number): object {
    if (!value || typeof value !== "object" || depth >= 8 || seen.has(value)) return { name: "UnknownProviderError" };
    seen.add(value);
    const read = (key: string): unknown => {
      try { return Reflect.get(value, key); } catch { return undefined; }
    };
    const name = read("name");
    const code = read("code");
    const cause = read("cause");
    return {
      name: typeof name === "string" && ["Error", "TypeError", "AbortError", "TimeoutError", "AuthApiError", "AuthRetryableFetchError"].includes(name) ? name : "UnknownProviderError",
      ...(typeof code === "string" && ["ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "unexpected_failure", "request_timeout", "over_request_rate_limit", "weak_password", "same_password"].includes(code) ? { code } : {}),
      ...(cause ? { cause: project(cause, depth + 1) } : {}),
    };
  }
  return project(error, 0);
}
