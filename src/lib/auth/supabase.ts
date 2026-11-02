import type { PublicRuntimeConfig } from "@/lib/runtime/public-config";
import { createClient } from "@supabase/supabase-js";

/**
 * 浏览器客户端（publishable key）
 * 在 Client Component 中使用，受 RLS 约束
 */
export function createBrowserClient(config: PublicRuntimeConfig) {
  return createClient(
    config.supabaseUrl,
    config.supabasePublishableKey
  );
}

/** Dedicated receive-only identity; never persists or replaces the signed-in user's Auth session. */
export function createLiveViewerClient(url: string, publishableKey: string, accessToken: () => Promise<string>) {
  return createClient(url, publishableKey, {
    accessToken,
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
