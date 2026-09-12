import { describe, expect, it } from "vitest";
import { assertPreviewAuthEnvironment, assertPreviewDatabaseUrl, assertPreviewMutationAllowed } from "@/lib/runtime/preview";

const readonlyUrl = "postgresql://rivalhub_preview_ro.cueazphyskstwdhnzsxx:abcdefghijklmnopqrstuvwxyz123456@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true";

describe("Preview mirror runtime boundary", () => {
  it("accepts only the fixed dev SELECT-only database URL", () => {
    expect(() => assertPreviewDatabaseUrl(readonlyUrl, { ...process.env, VERCEL_ENV: "preview" })).not.toThrow();
    expect(() => assertPreviewDatabaseUrl(readonlyUrl.replace("rivalhub_preview_ro", "postgres"), { ...process.env, VERCEL_ENV: "preview" })).toThrow();
  });

  it("rejects privileged or un-wired Auth environment", () => {
    const env = { ...process.env, VERCEL_ENV: "preview", NEXT_PUBLIC_SUPABASE_URL: "https://cueazphyskstwdhnzsxx.supabase.co", NEXT_PUBLIC_RIVALHUB_PREVIEW_READONLY: "1", RIVALHUB_PREVIEW_MIRROR_MODE: "production-derived" };
    expect(() => assertPreviewAuthEnvironment(env)).not.toThrow();
    expect(() => assertPreviewAuthEnvironment({ ...env, SUPABASE_SECRET_KEY: "secret" })).toThrow();
    expect(() => assertPreviewAuthEnvironment({ ...env, NEXT_PUBLIC_SUPABASE_URL: "https://sucokfotkypwqkckfynp.supabase.co" })).toThrow();
  });

  it("fails closed for mutation entrypoints", () => {
    expect(() => assertPreviewMutationAllowed({ ...process.env, VERCEL_ENV: "preview" })).toThrow();
    expect(() => assertPreviewMutationAllowed({ ...process.env, VERCEL_ENV: "production" })).not.toThrow();
  });
});
