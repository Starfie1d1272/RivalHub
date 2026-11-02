import { readV2Migrations } from "../legacy-lineage";
import { OFFICIAL_PREVIEW, OFFICIAL_PRODUCTION } from "../../../src/lib/runtime/official-deployment-profile.mjs";
import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { Pool } from "pg";
import { postgresConnection } from "../../../src/db/postgres-connection";
import { isMigrationLedgerPrefix, type MigrationIdentity } from "../migration-ledger";
import { resolve } from "node:path";
import type { ExpectedMigration } from "../production-preflight";
import type { RecoveryMigrationIdentity, RecoverySourceIdentity } from "./manifest";
import { assertReleaseIdentity } from "../../../src/lib/release/identity";

const projectRoot = resolve(process.cwd());
const DEFAULT_PRODUCTION_BASE_URL = OFFICIAL_PRODUCTION.origin;
const RELEASE_ENDPOINT_PATH = "/api/system/release";
const RELEASE_READBACK_TIMEOUT_MS = 10_000;

export type ProductionReleaseFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function resolveProductionSourceIdentity(
  cwd = projectRoot,
  env: Readonly<Record<string, string | undefined>> = process.env,
  fetcher: ProductionReleaseFetcher = fetch,
): Promise<Omit<RecoverySourceIdentity, "databaseMigrationTerminal">> {
  return readSourceIdentity(buildReleaseEndpoint(env.RIVALHUB_PRODUCTION_BASE_URL), cwd, fetcher);
}

/** The source is the actual running independent instance, never the candidate. */
export async function resolveInstanceSourceIdentity(
  origin: string,
  supabaseUrl: string,
  cwd = projectRoot,
  fetcher: ProductionReleaseFetcher = fetch,
  localOnly = false,
): Promise<Omit<RecoverySourceIdentity, "databaseMigrationTerminal">> {
  const parsed = new URL(origin);
  if (localOnly && (parsed.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) || parsed.origin !== origin)) throw new Error("Isolated source origin must be loopback.");
  const base = localOnly ? `${parsed.origin}${RELEASE_ENDPOINT_PATH}` : buildReleaseEndpoint(origin);
  if (new URL(base).origin === OFFICIAL_PRODUCTION.origin || new URL(base).hostname === new URL(OFFICIAL_PREVIEW.supabaseUrl).hostname) {
    throw new Error("Official source cannot be used as an independent instance.");
  }
  const endpoint = `${new URL(base).origin}/api/system/recovery-source`;
  let response: Response;
  try {
    response = await fetcher(endpoint, { method: "GET", headers: { accept: "application/json" }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(RELEASE_READBACK_TIMEOUT_MS) });
  } catch { throw new Error("Instance recovery source read-back failed; backup aborted."); }
  if (!response.ok) throw new Error("Instance recovery source unavailable; backup aborted.");
  let value: unknown;
  try { value = await response.json(); } catch { throw new Error("Instance recovery source response invalid."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Instance recovery source response invalid.");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== "databaseName,releaseCommit,releaseTag,supabaseUrl"
    || record.supabaseUrl !== supabaseUrl || record.databaseName !== "postgres") throw new Error("Running instance and backup database identity differ.");
  const identity = assertReleaseIdentity({ releaseTag: record.releaseTag, releaseCommit: record.releaseCommit }, "instance release identity");
  assertInstanceReleaseIdentity(identity.releaseTag, identity.releaseCommit, cwd);
  return { deployedReleaseTag: identity.releaseTag, deployedCommit: identity.releaseCommit };
}

/** Revalidate the installer-captured source and package ledger after the writer stops. */
export async function resolveStoppedInstanceSourceIdentity(
  frozenPath: string, sourceManifest: string, supabaseUrl: string, databaseUrl: string,
): Promise<Omit<RecoverySourceIdentity, "databaseMigrationTerminal">> {
  const file = lstatSync(frozenPath), parent = statSync(dirname(frozenPath));
  if (process.getuid?.() !== 0 || !file.isFile() || file.isSymbolicLink() || file.uid !== 0 || parent.uid !== 0
    || (file.mode & 0o077) || (parent.mode & 0o077) || file.size > 65536) throw new Error("Protected stopped-instance source required.");
  const record = JSON.parse(readFileSync(frozenPath, "utf8"));
  if (Object.keys(record).sort().join(",") !== "databaseName,releaseCommit,releaseTag,supabaseUrl"
    || record.supabaseUrl !== supabaseUrl || record.databaseName !== "postgres") throw new Error("Frozen source database identity differs.");
  assertInstanceReleaseIdentity(record.releaseTag, record.releaseCommit);
  const previous = JSON.parse(readFileSync(sourceManifest, "utf8")) as { releaseTag: string; sourceCommit: string; migrations: MigrationIdentity[] };
  if (previous.releaseTag !== record.releaseTag || previous.sourceCommit !== record.releaseCommit || !Array.isArray(previous.migrations) || !previous.migrations.length) throw new Error("Frozen source differs from installed package.");
  const pool = new Pool({ ...postgresConnection(databaseUrl), max: 1 });
  try {
    const result = await pool.query<{ hash: string; when: string }>('SELECT hash, created_at::bigint::text AS "when" FROM drizzle.__drizzle_migrations ORDER BY created_at, id');
    const ledger = result.rows.map(row => ({ hash: row.hash, when: Number(row.when) }));
    if (ledger.length !== previous.migrations.length || !isMigrationLedgerPrefix(ledger, previous.migrations)) throw new Error("Checkpoint database ledger differs from the running package.");
  } finally { await pool.end(); }
  return { deployedReleaseTag: record.releaseTag, deployedCommit: record.releaseCommit };
}

/** Instance build.mjs derives its release label from the committed package
 * version and full Git commit; it does not create a Git tag. */
export function assertInstanceReleaseIdentity(tag: string, commit: string, cwd = projectRoot): void {
  if (!/^[0-9a-f]{40}$/.test(commit) || resolveGitRevision(cwd, `${commit}^{commit}`).toLowerCase() !== commit) {
    throw new Error("Instance release commit is unavailable; recovery aborted.");
  }
  const result = spawnSync("git", ["show", `${commit}:package.json`], { cwd, encoding: "utf8" });
  let version: unknown;
  try { version = JSON.parse(result.stdout).version; } catch { throw new Error("Instance release package identity unavailable."); }
  if (result.error || result.status !== 0 || typeof version !== "string"
    || tag !== `v${version}-instance.${commit.slice(0, 12)}`) {
    throw new Error("Instance release label does not match its committed package and commit.");
  }
  const capability = spawnSync("git", ["cat-file", "-e", `${commit}:src/lib/competition/release-contract.json`], { cwd, stdio: "ignore" });
  if (capability.error || capability.status !== 0) throw new Error("Instance release lacks its competition capability contract.");
}

async function readSourceIdentity(
  endpoint: string,
  cwd: string,
  fetcher: ProductionReleaseFetcher,
): Promise<Omit<RecoverySourceIdentity, "databaseMigrationTerminal">> {
  let response: Response;
  try {
    response = await fetcher(endpoint, {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(RELEASE_READBACK_TIMEOUT_MS),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`canonical release identity read-back failed: ${reason}`);
  }

  if (!response.ok) {
    throw new Error(`canonical release identity returned HTTP ${response.status}; backup aborted.`);
  }

  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error("canonical release identity response is not valid JSON; backup aborted.");
  }

  const identity = assertReleaseIdentity(value, "canonical release identity");
  const taggedCommit = resolveGitRevision(cwd, `refs/tags/${identity.releaseTag}^{commit}`);
  if (taggedCommit.toLowerCase() !== identity.releaseCommit.toLowerCase()) {
    throw new Error("canonical release identity tag 与 commit 不匹配；backup aborted.");
  }
  return { deployedReleaseTag: identity.releaseTag, deployedCommit: identity.releaseCommit };
}

/** Detect a release or migration change during capture. This is evidence, not
 * a database-wide migration lock or an atomic DB/Storage snapshot. */
export function assertRecoverySourceUnchanged(
  before: Omit<RecoverySourceIdentity, "databaseMigrationTerminal"> & { databaseMigrationTerminal: RecoveryMigrationIdentity },
  after: Omit<RecoverySourceIdentity, "databaseMigrationTerminal"> & { databaseMigrationTerminal: RecoveryMigrationIdentity },
): void {
  const a = before.databaseMigrationTerminal;
  const b = after.databaseMigrationTerminal;
  if (before.deployedReleaseTag !== after.deployedReleaseTag
    || before.deployedCommit !== after.deployedCommit
    || a.terminalTag !== b.terminalTag || a.terminalHash !== b.terminalHash || a.terminalWhen !== b.terminalWhen
    || before.migrationLineage !== after.migrationLineage
    || JSON.stringify(before.v2MigrationLedger ?? null) !== JSON.stringify(after.v2MigrationLedger ?? null)
    || JSON.stringify(before.legacyMigrationLedger ?? null) !== JSON.stringify(after.legacyMigrationLedger ?? null)) {
    throw new Error("Recovery source release or migration ledger changed during snapshot; backup aborted.");
  }
}

/** Full Storage/lifecycle recovery needs the schema that owns evidence_object_key. */
export function assertV2FullRecoverySupported(terminalTag: string): void {
  const chain = readV2Migrations();
  const minimum = chain.findIndex((entry) => entry.tag === "0046_mixed_sprite");
  const terminal = chain.findIndex((entry) => entry.tag === terminalTag);
  if (minimum < 0 || terminal < minimum) {
    throw new Error("Current tools do not support full backup or restore before 0046; DB-only checkpoint remains available. Restore an existing historical artifact only with its matching tools.");
  }
}

export function buildRecoveryMigrationPlan(
  expected: readonly ExpectedMigration[],
  terminal: RecoveryMigrationIdentity,
): ExpectedMigration[] {
  const terminalIndex = expected.findIndex(
    (entry) => entry.tag === terminal.terminalTag
      && entry.hash === terminal.terminalHash
      && entry.when === terminal.terminalWhen,
  );
  if (terminalIndex < 0) {
    throw new Error("Recovery snapshot migration terminal is not present in this release's active chain; restore using the original immutable release tools, then upgrade. Restore aborted. ");
  }
  return expected.slice(0, terminalIndex + 1);
}

function resolveGitRevision(cwd: string, ref: string): string {
  const result = spawnSync("git", ["rev-parse", ref], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const commit = result.stdout.trim();
  if (result.error || result.status !== 0 || !/^[0-9a-f]{40}$/i.test(commit)) {
    throw new Error("source tag 无法解析为 commit；backup aborted。 ");
  }
  return commit;
}

function buildReleaseEndpoint(baseUrl: string | undefined): string {
  if (baseUrl !== undefined && !baseUrl.trim()) {
    throw new Error("RIVALHUB_PRODUCTION_BASE_URL 不能是空值；backup aborted。");
  }

  const configured = baseUrl?.trim() ?? DEFAULT_PRODUCTION_BASE_URL;
  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error("RIVALHUB_PRODUCTION_BASE_URL 必须是有效的 HTTPS origin；backup aborted。");
  }
  if (
    parsed.protocol !== "https:"
    || parsed.port
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || (parsed.pathname !== "" && parsed.pathname !== "/")
  ) {
    throw new Error("RIVALHUB_PRODUCTION_BASE_URL 必须是无凭据、无路径的 HTTPS origin；backup aborted。");
  }
  return `${parsed.origin}${RELEASE_ENDPOINT_PATH}`;
}
