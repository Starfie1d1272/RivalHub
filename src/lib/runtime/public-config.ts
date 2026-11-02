import { requireSupabasePublicKey } from "./supabase-keys";

export type PublicRuntimeConfig = {
  appOrigin: string;
  supabaseUrl: string;
  supabasePublishableKey: string;
  turnstileSiteKey: string;
  authEmailResendCooldownSeconds: number;
};

/** Read only explicitly public values; never serialize the environment itself. */
export function readPublicRuntimeConfig(env: NodeJS.ProcessEnv): PublicRuntimeConfig {
  const supabaseUrl = requireSupabaseOrigin(env.NEXT_PUBLIC_SUPABASE_URL);
  const cooldown = env.NEXT_PUBLIC_AUTH_EMAIL_RESEND_COOLDOWN_SECONDS;
  const seconds = cooldown === undefined || cooldown === "" ? 60 : Number(cooldown);
  if (!Number.isSafeInteger(seconds) || seconds <= 0) throw new Error("NEXT_PUBLIC_AUTH_EMAIL_RESEND_COOLDOWN_SECONDS 必须是正整数。");
  return {
    appOrigin: requireApplicationOrigin(env),
    supabaseUrl,
    supabasePublishableKey: requireSupabasePublicKey(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, supabaseUrl),
    turnstileSiteKey: env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() ?? "",
    authEmailResendCooldownSeconds: seconds,
  };
}

export function requireSupabaseOrigin(value: string | undefined): string {
  value = value?.trim();
  let url: URL;
  try { url = new URL(value ?? ""); } catch { throw new Error("NEXT_PUBLIC_SUPABASE_URL 必须是有效的 HTTP(S) origin。"); }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL 必须是 HTTPS origin（本地 loopback 可用 HTTP）。");
  }
  return url.origin;
}

/** Dynamic lookup prevents Next from freezing public values into the build. */
export function runtimePublicValue(name: string): string | undefined {
  return process.env[name];
}

export function requireApplicationOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.NEXT_PUBLIC_APP_URL?.trim();
  let url: URL;
  try { url = new URL(value ?? ""); } catch { throw new Error("NEXT_PUBLIC_APP_URL 必须是有效的 HTTP(S) origin。"); }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("NEXT_PUBLIC_APP_URL 必须是 HTTPS origin（本地 loopback 可用 HTTP）。");
  }
  return url.origin;
}
