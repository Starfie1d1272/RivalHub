import { existsSync, readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { assertProductionDatabaseUrl, PRODUCTION_PROJECT_REF } from "../db/production-environment.ts";
import { assertReleaseIdentity } from "../../src/lib/release/identity.ts";
import { publicConfiguration, configurationHash } from "./production-config.mjs";

export function assertProductionStandbyEnvironment(manifest, env = process.env) {
  assertReleaseIdentity({ releaseTag: manifest.releaseTag, releaseCommit: manifest.sourceCommit });
  if (manifest.environment !== "production" || manifest.projectRef !== PRODUCTION_PROJECT_REF
    || env.NODE_ENV !== "production" || env.VERCEL_ENV !== "production" || env.RIVALHUB_DB_TARGET !== "production") {
    throw new Error("Production package and explicit production runtime target required.");
  }
  assertProductionDatabaseUrl(env.DATABASE_URL);
  const expected = publicConfiguration(manifest.publicConfiguration);
  if (configurationHash(expected) !== manifest.configurationSha256
    || Object.entries(expected).some(([key, value]) => (env[key] ?? "") !== value)) {
    throw new Error("Public configuration differs from the production build; rebuild required.");
  }
  for (const key of ["ADMIN_SESSION_SECRET", "CRON_SECRET", "SUPABASE_JWT_SECRET", "SUPABASE_SECRET_KEY"]) {
    if (!env[key] || env[key] === "[SENSITIVE]") throw new Error(`Missing production runtime credential: ${key}`);
  }
  if (env.ADMIN_SESSION_SECRET.length < 32 || !env.SUPABASE_SECRET_KEY.startsWith("sb_secret_")) throw new Error("Invalid production credential format.");
  if (expected.NEXT_PUBLIC_TURNSTILE_SITE_KEY && !env.TURNSTILE_SECRET_KEY) throw new Error("TURNSTILE_SECRET_KEY required for the configured site key.");
  if (env.PRODUCT_TELEMETRY_ENABLED === "1" && (!env.PRODUCT_TELEMETRY_SIGNING_KEY || !env.PRODUCT_TELEMETRY_ACCOUNT_KEY)) throw new Error("Enabled product telemetry requires its existing credentials.");
  if (env.HOSTNAME !== "127.0.0.1" || env.PORT !== "3032") throw new Error("Production standby must use 127.0.0.1:3032.");
  if (env.RIVALHUB_E2E_AUTH_BOOTSTRAP) throw new Error("Production cannot enable test authentication.");
}

if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const manifest = JSON.parse(readFileSync(resolve(root, "standby.json"), "utf8"));
  assertProductionStandbyEnvironment(manifest);
  process.chdir(root);
  await import(new URL("../../server.js", import.meta.url));
}
