import "server-only";

import { unstable_rethrow } from "next/navigation";
import { captureException } from "@/lib/observability/server";
import { ProjectionTransportUnavailableError } from "./projection-transport";
import { classifyError } from "@/lib/observability/errors";

const PUBLIC_STATS_DEPENDENCY_DIGEST = "RIVALHUB_PUBLIC_STATS_DEPENDENCY_V1";

function isTransportedDependencyFailure(error: unknown): boolean {
  return error instanceof Error && "digest" in error && error.digest === PUBLIC_STATS_DEPENDENCY_DIGEST;
}

function isDependencyFailure(error: unknown): boolean {
  if (isTransportedDependencyFailure(error) || error instanceof ProjectionTransportUnavailableError) return true;
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

/** Next cache Flight strips code/cause in production but preserves explicit digests.
 * Classify before that boundary. Keep throwing: unavailable is never cached as
 * a successful statistics value, and program errors retain their normal path.
 */
export async function preservePublicStatsDependencyFailure<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    unstable_rethrow(error);
    if (!isDependencyFailure(error)) throw error;
    throw Object.assign(new Error("Public statistics dependency unavailable.", { cause: error }), { digest: PUBLIC_STATS_DEPENDENCY_DIGEST });
  }
}

/** Optional analytics must not turn a cache/provider outage into an identity-page outage. */
export async function readOptionalPublicStats<T>(operation: string, read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    unstable_rethrow(error);
    captureException("public_stats.unavailable", error, { scope: "stats", operation,
      ...(isTransportedDependencyFailure(error) ? { errorClass: "dependency" as const, retryable: true } : {}) });
    if (!isDependencyFailure(error)) throw error;
    return null;
  }
}
