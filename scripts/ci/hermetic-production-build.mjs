import { execFileSync, spawnSync } from "node:child_process";

const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (!/^[0-9a-f]{40}$/i.test(commit)) {
  throw new Error("Hermetic production build requires an exact checked-out commit.");
}

const buildEnvironment = { ...process.env };
for (const name of [
  "DATABASE_URL",
  "RIVALHUB_LOCAL_DATABASE_URL",
  "RIVALHUB_PRODUCTION_BACKUP_DATABASE_URL",
  "RIVALHUB_BACKUP_DATABASE_URL",
  "RIVALHUB_RECOVERY_DATABASE_URL",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "RIVALHUB_RECOVERY_SERVICE_ROLE_KEY",
  "RIVALHUB_STAGING_DB_PASSWORD",
  "RIVALHUB_ALLOW_REMOTE_DB_WRITE",
  "RIVALHUB_DB_TARGET",
]) {
  delete buildEnvironment[name];
}

Object.assign(buildEnvironment, {
  // Next's pinned @next/env loader otherwise reads a developer's .env.local
  // after the process environment has been sanitized.
  NODE_ENV: "production",
  __NEXT_PROCESSED_ENV: "true",
  VERCEL_ENV: "production",
  RIVALHUB_RELEASE_TAG: "v0.0.0-ci",
  RIVALHUB_RELEASE_COMMIT: commit,
});

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const result = spawnSync(pnpm, ["exec", "tsx", "scripts/vercel-build.ts"], {
  cwd: process.cwd(),
  env: buildEnvironment,
  stdio: "inherit",
});

if (result.error) throw result.error;
if (result.signal) throw new Error(`Hermetic production build 被信号 ${result.signal} 终止。`);
process.exit(result.status ?? 1);
