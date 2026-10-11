import "server-only";
import { AppError, ErrorCode } from "@/lib/errors";

/** Fixed product guidance; raw provider diagnostics remain server-side only. */
export class PasswordMutationError extends AppError {
  constructor(public readonly outcome: "unknown" | "rejected" | "finalization_unknown" | "pending", cause: unknown, public readonly providerOutcome?: "succeeded" | "rejected") {
    super(outcome === "rejected" ? ErrorCode.INTERNAL_ERROR : ErrorCode.PASSWORD_UPDATE_OUTCOME_UNKNOWN,
      outcome === "finalization_unknown"
        ? `${providerOutcome === "succeeded" ? "账号服务已确认密码更新成功" : "账号服务已明确拒绝密码更新"}，但应用安全状态未能确认完成，登录恢复尚未确认。请停止提交，勿尝试新旧密码；联系平台管理员，提供操作时间和排查编号，核查登录阻断与审计。刷新或重复重置不能修复该状态。`
        : outcome === "pending"
          ? "此前密码操作仍待核查，登录已暂停。请停止提交，勿尝试新旧密码；联系平台管理员，提供原操作时间和排查编号。刷新或重复重置不能解除阻断。"
          : outcome === "unknown"
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
      name: typeof name === "string" && ["Error", "TypeError", "AbortError", "TimeoutError", "AuthApiError", "AuthRetryableFetchError", "DatabaseError", "DrizzleQueryError"].includes(name) ? name : "UnknownProviderError",
      ...(typeof code === "string" && ["ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "unexpected_failure", "request_timeout", "over_request_rate_limit", "weak_password", "same_password", "08000", "08003", "08006", "40001", "40P01", "23502", "23503", "23505", "23514", "25P02", "42501", "53000", "53100", "53200", "53300", "55P03", "57014", "57P01", "57P02", "57P03", "P0001"].includes(code) ? { code } : {}),
      ...(cause ? { cause: project(cause, depth + 1) } : {}),
    };
  }
  return project(error, 0);
}
