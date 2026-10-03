/** Pure selection helpers; callers must pass literal NEXT_PUBLIC env references for Next inlining. */
export function requireSupabasePublicKey(publishable?: string, legacyAnon?: string): string {
  const key = publishable?.trim() || legacyAnon?.trim();
  if (!key) throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/NEXT_PUBLIC_SUPABASE_ANON_KEY 未设置。");
  if (key.startsWith("sb_secret_")) throw new Error("公开 Supabase client 不能使用 secret key。");
  // Legacy JWT shape is relevant only to rejecting a privileged key, never to Auth authorization.
  if (key.startsWith("eyJ")) {
    try {
      const payload = JSON.parse(atob(key.split(".")[1]!.replaceAll("-", "+").replaceAll("_", "/")));
      if (payload.role === "service_role") throw new Error("privileged");
    } catch {
      throw new Error("公开 Supabase client 的 legacy key 无效或具有特权。");
    }
  }
  return key;
}

export function requireSupabaseSecretKey(secret?: string, legacyServiceRole?: string): string {
  const key = secret?.trim() || legacyServiceRole?.trim();
  if (!key) throw new Error("SUPABASE_SECRET_KEY/SUPABASE_SERVICE_ROLE_KEY 未设置。");
  if (key.startsWith("sb_publishable_")) throw new Error("特权 Supabase client 不能使用 publishable key。");
  return key;
}
