import { describe, expect, it } from "vitest";
import { assertPreviewAuthEnvironment, assertPreviewDatabaseUrl } from "@/lib/runtime/preview";

const devUrl = "postgresql://postgres.cueazphyskstwdhnzsxx:abcdefghijklmnopqrstuvwxyz123456@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true";

describe("Preview mirror runtime boundary", () => {
  it("accepts only the fixed writable dev database URL", () => {
    expect(() => assertPreviewDatabaseUrl(devUrl, { ...process.env, VERCEL_ENV: "preview" })).not.toThrow();
    expect(() => assertPreviewDatabaseUrl(devUrl.replace("cueazphyskstwdhnzsxx", "sucokfotkypwqkckfynp"), { ...process.env, VERCEL_ENV: "preview" })).toThrow();
  });

  it("requires dev-scoped Auth and session credentials, preferring the secret key", () => {
    const env = { ...process.env, VERCEL_ENV: "preview", NEXT_PUBLIC_SUPABASE_URL: "https://cueazphyskstwdhnzsxx.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "dev-anon-key", SUPABASE_SECRET_KEY: "sb_secret_dev", ADMIN_SESSION_SECRET: "a".repeat(32) };
    expect(() => assertPreviewAuthEnvironment(env)).not.toThrow();
    expect(() => assertPreviewAuthEnvironment({ ...env, SUPABASE_SECRET_KEY: "", SUPABASE_SERVICE_ROLE_KEY: "legacy-service-key" })).not.toThrow();
    expect(() => assertPreviewAuthEnvironment({ ...env, NEXT_PUBLIC_SUPABASE_ANON_KEY: "" })).toThrow();
    expect(() => assertPreviewAuthEnvironment({ ...env, SUPABASE_SECRET_KEY: "", SUPABASE_SERVICE_ROLE_KEY: "" })).toThrow();
    expect(() => assertPreviewAuthEnvironment({ ...env, NEXT_PUBLIC_SUPABASE_URL: "https://sucokfotkypwqkckfynp.supabase.co" })).toThrow();
  });
});
