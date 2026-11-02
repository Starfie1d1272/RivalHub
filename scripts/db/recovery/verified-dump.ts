import { spawnSync } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { assertLocalContainerAccess } from "../local-container-guard";
import { parseLocalSupabaseStatus } from "../local-environment";
import { postgresConnection } from "../../../src/db/postgres-connection";

/** Supabase's dump template drops URL SSL parameters. Execute its exact filters
 * with explicit libpq verify-full inside a disposable PG17 client container. */
export function verifiedDumpScript(template: string, databaseUrl: string): string {
  const connection = postgresConnection(databaseUrl);
  if (!connection.ssl) throw new Error("Production dump requires verified remote TLS.");
  if (/export\s+PGSSL/i.test(template)) throw new Error("Unexpected dump TLS override; refusing backup.");
  if (!template.startsWith("#!/usr/bin/env bash\nset -euo pipefail") || !/\bpg_dump(?:all)?\b/.test(template)) {
    throw new Error("Unknown Supabase dump template; refusing an unverified backup.");
  }
  return template.replace("set -euo pipefail", `set -euo pipefail
export PGSSLMODE=verify-full
export PGSSLROOTCERT=/tmp/rivalhub-root.crt
cat > "$PGSSLROOTCERT" <<'RIVALHUB_PUBLIC_CA'
${connection.ssl.ca}
RIVALHUB_PUBLIC_CA`);
}

export function runVerifiedSupabaseDump(databaseUrl: string, flags: readonly string[], outputPath: string): void {
  if (process.env.RIVALHUB_BACKUP_SOURCE === "isolated-instance") {
    if (process.env.RIVALHUB_DB_TARGET !== "local" || process.env.RIVALHUB_ALLOW_REMOTE_DB_WRITE) throw new Error("Isolated dump requires local-only configuration.");
    assertLocalContainerAccess("isolated instance recovery backup");
    const workdir = process.env.RIVALHUB_BACKUP_SUPABASE_WORKDIR?.trim();
    if (!workdir) throw new Error("Isolated backup Supabase workdir required.");
    const bin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    const status = spawnSync(bin, ["exec", "supabase", "status", "--workdir", workdir, "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (status.error || status.status !== 0) throw new Error("Isolated backup provider status unavailable.");
    const local = parseLocalSupabaseStatus(status.stdout);
    if (postgresConnection(local.databaseUrl).connectionString !== postgresConnection(databaseUrl).connectionString) throw new Error("Isolated backup database identity changed.");
    const result = spawnSync(bin, ["exec", "supabase", "db", "dump", "--local", "--workdir", workdir, "--file", outputPath, ...flags], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (result.error || result.status !== 0) throw new Error("Isolated Supabase dump failed; backup aborted.");
    return;
  }
  const url = new URL(databaseUrl);
  const keys = [...url.searchParams.keys()];
  if (keys.some((key) => key !== "sslmode") || keys.length > 1) {
    throw new Error("Backup database URL contains unsupported connection options.");
  }
  // URL options override libpq environment variables. Remove the compatible
  // sslmode before applying our explicit verify-full contract in the wrapper.
  const connection = postgresConnection(databaseUrl);
  const template = spawnSync(process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    ["exec", "supabase", "db", "dump", "--db-url", connection.connectionString, "--dry-run", ...flags],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (template.error || template.status !== 0) throw new Error("Supabase dump template generation failed.");
  const script = verifiedDumpScript(template.stdout, databaseUrl);
  const output = openSync(outputPath, "w", 0o600);
  try {
    const result = spawnSync("docker", ["run", "--rm", "-i", "postgres:17", "bash", "-s"],
      { input: script, stdio: ["pipe", output, "pipe"], encoding: "utf8" });
    // Never print the generated script, credential-bearing command or raw errors.
    if (result.error || result.status !== 0) throw new Error("Verified PostgreSQL dump failed; backup aborted.");
  } finally { closeSync(output); }
}
