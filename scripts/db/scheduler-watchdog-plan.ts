import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Pool } from "pg";
import { assertReleaseIdentity, type ReleaseIdentity } from "../../src/lib/release/identity";
import type { PrimaryHealthFacts } from "../../src/lib/scheduler/health-contract";
import { readCanonicalProductionIdentity } from "../release/production-identity";

type Definition = { key: string; staleAfterMs: number };
type HealthRow = {
  job_key: string;
  last_primary_triggered_at: Date | null;
  last_primary_dispatch_requested_at: Date | null;
  last_primary_endpoint_succeeded_at: Date | null;
};
type Registry = {
  definitions: readonly Definition[];
  isHealthy: (facts: PrimaryHealthFacts | null, definition: Definition, now: Date) => boolean;
};

/** The controller and dependencies remain at the workflow's main SHA. Only the
 * canonical scheduler owners come from the independently verified deployed SHA. */
export function verifyProductionSource(identity: ReleaseIdentity, cwd = process.cwd()): void {
  const tagCommit = git(cwd, ["rev-parse", "--verify", `refs/tags/${identity.releaseTag}^{commit}`]);
  if (tagCommit !== identity.releaseCommit) throw new Error("Production tag/commit mismatch; scheduler aborted.");
  try {
    git(cwd, ["merge-base", "--is-ancestor", identity.releaseCommit, "HEAD"]);
  } catch {
    throw new Error("Production commit is not an ancestor of the main operator SHA; scheduler aborted.");
  }
}

export async function loadProductionRegistry(sourceRoot: string, identity: ReleaseIdentity): Promise<Registry> {
  if (git(sourceRoot, ["rev-parse", "HEAD"]) !== identity.releaseCommit) {
    throw new Error("Scheduler source checkout does not match frozen Production identity.");
  }
  if (git(sourceRoot, ["status", "--porcelain", "--untracked-files=all"])) {
    throw new Error("Scheduler source checkout must be clean.");
  }
  const definitionsModule = await import(pathToFileURL(resolve(sourceRoot, "src/lib/scheduler/definitions.ts")).href);
  const healthModule = await import(pathToFileURL(resolve(sourceRoot, "src/lib/scheduler/health-contract.ts")).href);
  const definitions: unknown = definitionsModule.SCHEDULER_JOB_DEFINITIONS;
  if (!Array.isArray(definitions) || definitions.length === 0 || definitions.some((definition: Definition) => (
    typeof definition?.key !== "string" || !/^[a-z][a-z0-9-]*$/.test(definition.key)
    || !Number.isFinite(definition.staleAfterMs) || definition.staleAfterMs <= 0
  )) || new Set(definitions.map((definition: Definition) => definition.key)).size !== definitions.length
    || typeof healthModule.isPrimaryHealthHealthy !== "function") {
    throw new Error("Deployed scheduler registry/health contract is invalid; scheduler aborted.");
  }
  return { definitions, isHealthy: healthModule.isPrimaryHealthHealthy };
}

export async function planProductionFallbacks(
  registry: Registry,
  mode: "scheduled" | "manual",
  readHealth: (keys: string[]) => Promise<HealthRow[]>,
  warn: (message: string) => void = console.error,
  now = new Date(),
): Promise<string[]> {
  const all = registry.definitions.map((definition) => definition.key);
  if (mode === "manual") return all;
  let rows: HealthRow[];
  try {
    rows = await readHealth(all);
  } catch {
    // Identity/source failures never enter this fallback. Raw DB errors can
    // contain credentials, so only emit a stable diagnostic.
    warn("::warning::Scheduler health read failed; falling back to all verified deployed targets.");
    return all;
  }
  const byKey = new Map(rows.map((row) => [row.job_key, row]));
  return registry.definitions.filter((definition) => {
    const row = byKey.get(definition.key);
    return !registry.isHealthy(row ? {
      lastPrimaryTriggeredAt: row.last_primary_triggered_at,
      lastPrimaryDispatchRequestedAt: row.last_primary_dispatch_requested_at,
      lastPrimaryEndpointSucceededAt: row.last_primary_endpoint_succeeded_at,
    } : null, definition, now);
  }).map((definition) => definition.key);
}

export function assertUnchangedProduction(expected: ReleaseIdentity, actual: ReleaseIdentity): void {
  if (actual.releaseTag !== expected.releaseTag || actual.releaseCommit !== expected.releaseCommit) {
    throw new Error("Production changed after scheduler planning; abort and rerun against the new release.");
  }
}

async function readHealth(keys: string[]): Promise<HealthRow[]> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required for scheduler watchdog planning.");
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
    max: 1,
    connectionTimeoutMillis: 10_000,
    query_timeout: 10_000,
  });
  try {
    const client = await pool.connect();
    try {
      // Transaction-local settings also work through a transaction pooler;
      // do not depend on provider support for PostgreSQL startup options.
      await client.query("BEGIN READ ONLY");
      await client.query("SET LOCAL statement_timeout = '10s'");
      const result = await client.query<HealthRow>(`
        SELECT job_key, last_primary_triggered_at,
          last_primary_dispatch_requested_at, last_primary_endpoint_succeeded_at
        FROM public.scheduled_job_health
        WHERE job_key = ANY($1::text[])
      `, [keys]);
      await client.query("COMMIT");
      return result.rows;
    } finally {
      // Destroy this one-shot connection, also rolling back a failed read.
      client.release(true);
    }
  } finally {
    await pool.end();
  }
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

async function main(): Promise<void> {
  const [mode, sourceRoot] = process.argv.slice(2);
  if (mode === "freeze") {
    const identity = await readCanonicalProductionIdentity();
    verifyProductionSource(identity);
    if (!process.env.GITHUB_OUTPUT) throw new Error("GITHUB_OUTPUT is required for the frozen Production pair.");
    appendFileSync(process.env.GITHUB_OUTPUT,
      `release_tag=${identity.releaseTag}\nrelease_commit=${identity.releaseCommit}\n`, "utf8");
    console.log(`Scheduler Production source: ${identity.releaseTag}/${identity.releaseCommit}`);
    return;
  }
  if (mode !== "verify" && mode !== "manual" && mode !== "scheduled") {
    throw new Error("Expected scheduler mode: freeze, verify, manual or scheduled.");
  }
  const identity = assertReleaseIdentity({
    releaseTag: process.env.RIVALHUB_SCHEDULER_RELEASE_TAG,
    releaseCommit: process.env.RIVALHUB_SCHEDULER_RELEASE_COMMIT,
  }, "frozen scheduler Production identity");
  verifyProductionSource(identity);
  if (mode === "verify") {
    assertUnchangedProduction(identity, await readCanonicalProductionIdentity());
    return;
  }
  if (!sourceRoot) throw new Error("Exact Production source checkout is required for scheduler planning.");
  const registry = await loadProductionRegistry(resolve(sourceRoot), identity);
  const jobs = await planProductionFallbacks(registry, mode, readHealth);
  process.stdout.write(JSON.stringify(jobs));
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
