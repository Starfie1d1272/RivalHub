import { spawnSync } from "node:child_process";
import { closeSync, openSync } from "node:fs";
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
  postgresConnection(databaseUrl);
  const template = spawnSync(process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    ["exec", "supabase", "db", "dump", "--db-url", databaseUrl, "--dry-run", ...flags],
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
