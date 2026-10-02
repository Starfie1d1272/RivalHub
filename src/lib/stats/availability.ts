import "server-only";

import { unstable_rethrow } from "next/navigation";
import { captureException } from "@/lib/observability/server";
import { classifyError } from "@/lib/observability/errors";

function isDependencyFailure(error: unknown): boolean {
  if (classifyError(error).retryable) return true;
  let cause = error;
  for (let depth = 0; depth < 5 && cause instanceof Error; depth++) {
    const code = "code" in cause ? String(cause.code) : "";
    if (/^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT)$/.test(code)) return true;
    if (["AbortError", "TimeoutError"].includes(cause.name) || cause.message === "fetch failed") return true;
    cause = cause.cause;
  }
  return false;
}

/** Optional analytics must not turn a cache/provider outage into an identity-page outage. */
export async function readOptionalPublicStats<T>(operation: string, read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    unstable_rethrow(error);
    captureException("public_stats.unavailable", error, { scope: "stats", operation });
    if (!isDependencyFailure(error)) throw error;
    return null;
  }
}
