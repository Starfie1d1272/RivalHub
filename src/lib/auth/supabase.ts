import { createClient } from "@supabase/supabase-js";

/**
 * 浏览器客户端（anon key）
 * 在 Client Component 中使用，受 RLS 约束
 */
export function createBrowserClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
