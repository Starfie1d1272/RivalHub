import "server-only";
import { providerFetch } from "@/lib/observability/fetch";

/**
 * httpSend only needs status. Its SDK timeout ends at response headers, before
 * parsing error JSON. Discard the untrusted body so a 429 slow-body cannot hold
 * authority locks indefinitely. Keep the SDK AbortSignal, and never retry.
 */
export const liveBroadcastFetch: typeof fetch = async (input, init) => {
  const response = await providerFetch("supabase")(input, init);
  void response.body?.cancel().catch(() => {});
  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
  });
};
