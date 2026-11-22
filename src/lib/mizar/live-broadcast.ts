import "server-only";
import { extractSafeException } from "@/lib/observability/redact";
import { assertPreviewAuthEnvironment } from "@/lib/runtime/preview";
import { requireSupabaseSecretKey } from "@/lib/runtime/supabase-keys";

type BroadcastFailure =
  | "auth"
  | "request"
  | "rate_limited"
  | "upstream"
  | "endpoint"
  | "timeout"
  | "transport"
  | "unknown";

/** Canonical redaction follows bounded causes; do not retain messages or stacks. */
export function liveBroadcastException(error: unknown) {
  const { name, code } = extractSafeException(error, null);
  return { name, code };
}

/** Prepare the same private Broadcast REST endpoint used by Realtime's httpSend. */
export function prepareLiveBroadcast() {
  assertPreviewAuthEnvironment();
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = requireSupabaseSecretKey(process.env.SUPABASE_SECRET_KEY, base);
  const url = new URL("realtime/v1/api/broadcast/", `${base?.replace(/\/+$/, "")}/`);
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new Error("Invalid Supabase URL");
  return { url: url.href, key };
}

export async function sendLiveBroadcast(
  config: ReturnType<typeof prepareLiveBroadcast>,
  topic: string,
  payload: unknown,
  fetcher: typeof fetch,
) {
  const url = new URL(`${config.url}${encodeURIComponent(topic)}/events/snapshot`);
  url.searchParams.set("apikey", config.key);
  url.searchParams.set("vsn", "2.0.0");
  url.searchParams.set("private", "true");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  try {
    const response = await fetcher(url, {
      method: "POST",
      headers: {
        apikey: config.key,
        Authorization: `Bearer ${config.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (response.status !== 202) throw new Error("broadcast_unavailable");
  } finally {
    clearTimeout(timeout);
  }
}

/** Request-local evidence: never retain URL, headers, body or provider error text. */
export function createLiveBroadcastFetch() {
  let httpStatus: number | undefined;
  let failure: BroadcastFailure = "unknown";
  let exception: ReturnType<typeof liveBroadcastException> | undefined;
  const fetcher: typeof fetch = async (input, init) => {
    try {
      const response = await fetch(input, init);
      httpStatus = response.status;
      failure =
        response.status === 401 || response.status === 403
          ? "auth"
          : response.status === 429
            ? "rate_limited"
            : response.status === 404
              ? "endpoint"
              : response.status >= 500
                ? "upstream"
                : response.status >= 400
                  ? "request"
                  : "unknown";
      // httpSend needs status only. A slow/untrusted failure body cannot hold
      // authority locks. Preserve the SDK's AbortSignal and never retry.
      void response.body?.cancel().catch(() => {});
      return new Response(null, { status: response.status, statusText: response.statusText });
    } catch (error) {
      exception = liveBroadcastException(error);
      failure =
        init?.signal?.aborted ||
        (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"))
          ? "timeout"
          : "transport";
      throw error;
    }
  };
  return {
    fetch: fetcher,
    evidence: () => ({ httpStatus, reason: failure }),
    exception: () => exception,
  };
}
