import { createClient } from "@supabase/supabase-js";

/**
 * 服务端专用客户端（Service Role Key，绕过 RLS）
 * 仅在 Server Action / API Route 中使用，禁止暴露给浏览器
 */
export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

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

/**
 * Server Component 客户端
 * Phase 5 接入 cookie-based Auth 后替换为 @supabase/ssr 版本
 */
export { createServiceClient as createServerClient };
