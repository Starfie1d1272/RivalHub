export function failureClass(error: unknown): string {
  for (let value: unknown = error, depth = 0; value && depth < 5; depth++) {
    if (typeof value !== "object") break;
    const item = value as { code?: unknown; message?: unknown; cause?: unknown };
    if (item.code === "55P03") return "lock_timeout";
    if (item.code === "57014") return "statement_timeout_or_cancel";
    if (typeof item.code === "string" && /^[A-Z0-9]{5}$/.test(item.code)) return `sqlstate_${item.code}`;
    if (typeof item.message === "string" && /timeout exceeded when trying to connect/i.test(item.message)) return "pool_acquisition_timeout";
    value = item.cause;
  }
  return "unknown";
}
