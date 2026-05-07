// TODO: 实现 Supabase client 工厂
// - createServerClient()：Server Component / Server Action 用（使用 cookies()）
// - createBrowserClient()：Client Component 用（单例）
// - createServiceClient()：Server Action 内部操作（Service Role Key，绕过 RLS）

import type { SupabaseClient } from "@supabase/supabase-js";

export function createServerClient(): SupabaseClient {
  throw new Error("not implemented");
}

export function createBrowserClient(): SupabaseClient {
  throw new Error("not implemented");
}

export function createServiceClient(): SupabaseClient {
  throw new Error("not implemented");
}
