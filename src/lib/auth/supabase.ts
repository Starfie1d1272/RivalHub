import { createClient } from "@supabase/supabase-js";

/** Dedicated receive-only identity; never persists or replaces the signed-in user's Auth session. */
export function createLiveViewerClient(
  url: string,
  publishableKey: string,
  accessToken: () => Promise<string>,
) {
  return createClient(url, publishableKey, {
    accessToken,
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
