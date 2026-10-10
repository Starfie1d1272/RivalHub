import "server-only";
import { providerFetch } from "@/lib/observability/fetch";
import { extractSafeException } from "@/lib/observability/redact";

type BroadcastFailure = "auth" | "request" | "rate_limited" | "upstream" | "endpoint" | "timeout" | "transport" | "unknown";

/** Canonical redaction follows bounded causes; do not retain messages or stacks. */
export function liveBroadcastException(error: unknown) {
  const { name, code } = extractSafeException(error, null);
  return { name, code };
}

/** Request-local evidence: never retain URL, headers, body or provider error text. */
export function createLiveBroadcastFetch() {
  let httpStatus: number | undefined;
  let failure: BroadcastFailure = "unknown";
  let exception: ReturnType<typeof liveBroadcastException> | undefined;
  const fetcher: typeof fetch = async (input, init) => {
    try {
      const response = await providerFetch("supabase")(input, init);
      httpStatus = response.status;
      failure = response.status === 401 || response.status === 403 ? "auth"
        : response.status === 429 ? "rate_limited"
        : response.status === 404 ? "endpoint"
        : response.status >= 500 ? "upstream"
        : response.status >= 400 ? "request" : "unknown";
      // httpSend needs status only. A slow/untrusted failure body cannot hold
      // authority locks. Preserve the SDK's AbortSignal and never retry.
      void response.body?.cancel().catch(() => {});
      return new Response(null, { status: response.status, statusText: response.statusText });
    } catch (error) {
      exception = liveBroadcastException(error);
      failure = init?.signal?.aborted || (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) ? "timeout" : "transport";
      throw error;
    }
  };
  return { fetch: fetcher, evidence: () => ({ httpStatus, reason: failure }), exception: () => exception };
}
