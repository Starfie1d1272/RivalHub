/** Pure key contract; callers pass literal NEXT_PUBLIC references for Next inlining.
 * Legacy JWT-shaped keys are accepted only from the canonical loopback adapter. */
export function requireSupabasePublicKey(publishable?: string, apiUrl?: string): string {
  return requireKey(publishable, apiUrl, "anon", "sb_publishable_", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
}

export function requireSupabaseSecretKey(secret?: string, apiUrl?: string): string {
  return requireKey(secret, apiUrl, "service_role", "sb_secret_", "SUPABASE_SECRET_KEY");
}

function requireKey(value: string | undefined, apiUrl: string | undefined, role: string, prefix: string, label: string): string {
  const key = value?.trim();
  if (!key) throw new Error(`${label} 未设置。`);
  if (key.startsWith(prefix)) return key;
  // This inspects configuration privilege only, never authorizes an Auth user.
  try {
    const url = new URL(apiUrl ?? "");
    if (["http:", "https:"].includes(url.protocol) && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && key.startsWith("eyJ")) {
      const payload = JSON.parse(atob(key.split(".")[1]!.replaceAll("-", "+").replaceAll("_", "/")));
      if (payload.role === role) return key;
    }
  } catch { /* fail closed below, without echoing credentials */ }
  throw new Error(`${label} 必须使用对应现代 key；legacy JWT 仅限 loopback Local Supabase adapter。`);
}
