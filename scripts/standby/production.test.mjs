import assert from "node:assert/strict";
import { test } from "node:test";
import { assertProductionStandbyEnvironment } from "./start-production.mjs";
import { publicConfiguration, configurationHash } from "./production-config.mjs";
import { PRODUCTION_PROJECT_REF, PRODUCTION_POOLER_HOST } from "../db/production-environment.ts";

const config = publicConfiguration({ NEXT_PUBLIC_APP_URL: "https://match.starfie1d.top",
  NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_PROJECT_REF}.supabase.co`, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" });
const manifest = { environment: "production", projectRef: PRODUCTION_PROJECT_REF, releaseTag: "v2.21.10",
  sourceCommit: "a".repeat(40), publicConfiguration: config, configurationSha256: configurationHash(config) };
const env = { ...config, NODE_ENV: "production", VERCEL_ENV: "production", RIVALHUB_DB_TARGET: "production",
  DATABASE_URL: `postgresql://postgres.${PRODUCTION_PROJECT_REF}:test@${PRODUCTION_POOLER_HOST}:6543/postgres?pgbouncer=true`,
  ADMIN_SESSION_SECRET: "test-session-secret-at-least-32-characters", CRON_SECRET: "test-cron", SUPABASE_JWT_SECRET: "test-jwt",
  SUPABASE_SECRET_KEY: "sb_secret_test", HOSTNAME: "127.0.0.1", PORT: "3032" };

test("production package rejects environment crossover, changed build inputs and public listeners", () => {
  assert.doesNotThrow(() => assertProductionStandbyEnvironment(manifest, env));
  for (const changed of [
    { VERCEL_ENV: "preview" }, { RIVALHUB_DB_TARGET: "preview" },
    { DATABASE_URL: env.DATABASE_URL.replace(PRODUCTION_PROJECT_REF, "dtdzxnzjtohzjmfkighg") },
    { DATABASE_URL: env.DATABASE_URL.replace(PRODUCTION_POOLER_HOST, "attacker.example") },
    { NEXT_PUBLIC_SUPABASE_URL: "https://dtdzxnzjtohzjmfkighg.supabase.co" },
    { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_changed" }, { NEXT_PUBLIC_APP_URL: "https://preview.example" },
    { SUPABASE_JWT_SECRET: "[SENSITIVE]" }, { ADMIN_SESSION_SECRET: "" }, { CRON_SECRET: "" },
    { HOSTNAME: "0.0.0.0" }, { PORT: "3031" }, { RIVALHUB_E2E_AUTH_BOOTSTRAP: "1" },
    { PRODUCT_TELEMETRY_ENABLED: "1" },
  ]) assert.throws(() => assertProductionStandbyEnvironment(manifest, { ...env, ...changed }));
  for (const changed of [{ environment: "preview" }, { sourceCommit: "wrong" }, { configurationSha256: "wrong" }]) {
    assert.throws(() => assertProductionStandbyEnvironment({ ...manifest, ...changed }, env));
  }
});

test("public build input allowlist excludes credentials and requires production identity", () => {
  assert.throws(() => publicConfiguration({ ...config, SUPABASE_SECRET_KEY: "sb_secret_private" }));
  assert.throws(() => publicConfiguration({ ...config, NEXT_PUBLIC_APP_URL: "https://preview.example" }));
  assert.equal(configurationHash(config), configurationHash(Object.fromEntries(Object.entries(config).reverse())));
});
