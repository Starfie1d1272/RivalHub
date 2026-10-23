import { createHash } from "node:crypto";
import { PRODUCTION_PROJECT_REF } from "../db/production-environment.ts";

export const PRODUCTION_ORIGIN = "https://match.starfie1d.top";
export const PUBLIC_KEYS = [
  "NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_TURNSTILE_SITE_KEY", "NEXT_PUBLIC_AUTH_EMAIL_RESEND_COOLDOWN_SECONDS",
];

export function publicConfiguration(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some(key => !PUBLIC_KEYS.includes(key))) throw new Error("Only declared public build configuration is accepted.");
  const config = Object.fromEntries(PUBLIC_KEYS.map(key => [key, input[key] ?? ""]));
  if (Object.values(config).some(value => typeof value !== "string" || /[\r\n]/.test(value))) throw new Error("Invalid public configuration value.");
  if (config.NEXT_PUBLIC_APP_URL !== PRODUCTION_ORIGIN
    || config.NEXT_PUBLIC_SUPABASE_URL !== `https://${PRODUCTION_PROJECT_REF}.supabase.co`
    || !config.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.startsWith("sb_publishable_")) {
    throw new Error("Production origin and Supabase public configuration required.");
  }
  return config;
}

export function configurationHash(config) {
  return createHash("sha256").update(JSON.stringify(publicConfiguration(config))).digest("hex");
}
