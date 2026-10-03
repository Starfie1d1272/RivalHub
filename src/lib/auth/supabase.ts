import { requireSupabasePublicKey } from "@/lib/runtime/supabase-keys";
import { createClient } from "@supabase/supabase-js";

/**
 * 浏览器客户端（publishable key，兼容 legacy anon）
 * 在 Client Component 中使用，受 RLS 约束
 */
export function createBrowserClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    requireSupabasePublicKey(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  );
}

/** Dedicated receive-only identity; never persists or replaces the signed-in user's Auth session. */
export function createLiveViewerClient(url: string, publishableKey: string, accessToken: () => Promise<string>) {
  return createClient(url, publishableKey, {
    accessToken,
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
