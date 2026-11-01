import assert from "node:assert/strict";
import { test } from "node:test";
import { assertStandbyEnvironment } from "./start.mjs";
import { PREVIEW_PROJECT_REF } from "../../src/lib/runtime/preview.ts";

const manifest = { environment: "preview", projectRef: PREVIEW_PROJECT_REF, applicationOrigin: "https://preview.example.test", publicKey: "sb_publishable_test" };
const env = {
  VERCEL_ENV: "preview", NEXT_PUBLIC_APP_URL: manifest.applicationOrigin,
  NEXT_PUBLIC_SUPABASE_URL: `https://${PREVIEW_PROJECT_REF}.supabase.co`,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: manifest.publicKey, SUPABASE_SECRET_KEY: "sb_secret_test",
  ADMIN_SESSION_SECRET: "preview-test-session-secret-at-least-32-chars", SUPABASE_JWT_SECRET: "preview-test-jwt",
  DATABASE_URL: `postgresql://postgres.${PREVIEW_PROJECT_REF}:test@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true`,
  HOSTNAME: "127.0.0.1", PORT: "3031",
};
test("Preview standby refuses production credentials, target switches, and public exposure", () => {
  assert.doesNotThrow(() => assertStandbyEnvironment(manifest, env));
  for (const changed of [
    { VERCEL_ENV: "production" },
    { DATABASE_URL: env.DATABASE_URL.replace(PREVIEW_PROJECT_REF, "ggkxqgbiudlovcgizgsq") },
    { NEXT_PUBLIC_SUPABASE_URL: "https://ggkxqgbiudlovcgizgsq.supabase.co" },
    { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_other" },
    { NEXT_PUBLIC_APP_URL: "https://match.starfie1d.top" },
    { SUPABASE_JWT_SECRET: "[SENSITIVE]" },
    { HOSTNAME: "0.0.0.0" },
  ]) assert.throws(() => assertStandbyEnvironment(manifest, { ...env, ...changed }));
  assert.throws(() => assertStandbyEnvironment({ ...manifest, environment: "production" }, env));
});
