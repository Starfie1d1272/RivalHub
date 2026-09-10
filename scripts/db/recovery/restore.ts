import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { Pool } from "pg";
import {
  buildIsolatedRecoveryEnvironment,
  parseLocalRecoveryStatus,
  PRODUCTION_PROJECT_REF,
  type IsolatedRecoveryEnvironment,
} from "./environment";
import {
  assertRecoveryCompletionMarker,
  assertRecoveryFormatCompatibility,
  assertRecoveryManifest,
  assertRecoverySidecar,
  sha256File,
  type RecoveryCompletionMarker,
  type RecoveryManifest,
  type RecoverySidecar,
} from "./manifest";
import {
  readStorageBuckets,
  readStorageIndex,
  restoreStorageBuckets,
  restoreStorageSnapshot,
  type StorageBucketRecord,
} from "./storage";
import { readManagedStorageReferences } from "./storage-policy";
import { buildRecoveryR2Keys } from "./r2";
import { buildRecoveryMigrationPlan } from "./source";
import { assertManifestMigrationMatches, verifyRecoveryDatabase } from "./verify";
import { readExpectedMigrations, type ExpectedMigration, type Migration } from "../production-preflight";

const projectRoot = resolve(process.cwd());
const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

interface RestoreArguments {
  artifactPath: string;
  manifestPath: string;
  completionPath: string;
}

async function main(): Promise<void> {
  assertRecoveryFormatCompatibility();
  const args = parseArguments(process.argv.slice(2));
  const target = readRecoveryTarget();
  const tempRoot = mkdtempSync(join(tmpdir(), "rivalhub-restore-"));
  const archivePath = join(tempRoot, "backup.tar.gz");

  try {
    const sidecar = readJson(args.manifestPath, assertRecoverySidecar);
    const completion = readJson(args.completionPath, assertRecoveryCompletionMarker);
    assertCompletionMatchesSidecar(completion, sidecar);
    assertArtifactMatchesSidecar(args.artifactPath, sidecar);
    decryptArtifact(args.artifactPath, archivePath);
    extractSafeArchive(archivePath, tempRoot);

    const stagingRoot = resolve(tempRoot, "backup");
    const manifest = readJson(join(stagingRoot, "manifest.json"), assertRecoveryManifest);
    if (sha256File(join(stagingRoot, "manifest.json")) !== sidecar.manifestSha256) {
      throw new Error("Recovery manifest checksum does not match the sidecar; restore aborted. ");
    }
    assertManifestCompatibility(manifest);
    assertSnapshotIdentity(manifest, sidecar);
    verifyStagedFiles(stagingRoot, manifest);

    const pool = new Pool({ connectionString: target.databaseUrl, ssl: false, max: 1 });
    try {
      const expectedBuckets = readStorageBuckets(resolve(stagingRoot, "storage/buckets.json"));
      await assertRecoveryTargetIsEmpty(pool, expectedBuckets);
      await ensureTargetMigration(pool, manifest, target.databaseUrl, tempRoot);
      await prepareTargetForDataImport(pool);
      applyDatabaseData(target.databaseUrl, resolve(stagingRoot, "data.sql"), tempRoot);

      await verifyRecoveryDatabase(pool, {
        expectedMigration: manifest.source.databaseMigrationTerminal,
        skipExpiredSensitiveEvidence: true,
      });
      runLifecycleReconciliation(target);
      const activeStorageReferences = await readManagedStorageReferences(pool);
      const storageClient = createClient(target.supabase.apiUrl, target.supabase.serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const bucketCount = await restoreStorageBuckets(storageClient, resolve(stagingRoot, "storage"));
      if (bucketCount !== manifest.storage.bucketCount) {
        throw new Error("Restored Storage bucket count does not match the backup manifest; restore aborted. ");
      }
      const storageResult = await restoreStorageSnapshot(
        storageClient,
        resolve(stagingRoot, "storage"),
        activeStorageReferences,
      );
      if (storageResult.restoredObjects + storageResult.skippedInactiveTemporaryObjects !== manifest.storage.objectCount) {
        throw new Error("Restored Storage object count does not match the backup manifest; restore aborted. ");
      }
      if (storageResult.restoredBytes + storageResult.skippedInactiveTemporaryObjectBytes !== manifest.storage.totalBytes) {
        throw new Error("Restored Storage byte count does not match the backup manifest; restore aborted. ");
      }
      await verifyRecoveryDatabase(pool, { expectedMigration: manifest.source.databaseMigrationTerminal });
      console.log(
        `Isolated recovery restore verified: run=${manifest.runId}, migration=${manifest.source.databaseMigrationTerminal.terminalTag}, storageObjects=${storageResult.restoredObjects}, skippedInactiveTemporaryObjects=${storageResult.skippedInactiveTemporaryObjects}.`,
      );
    } finally {
      await pool.end();
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function parseArguments(args: readonly string[]): RestoreArguments {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error("用法：tsx scripts/db/recovery/restore.ts --artifact <file.age> --manifest <file.manifest.json> --completion <file.complete.json>");
    }
    values.set(name.slice(2), value);
    index += 1;
  }
  const artifactPath = required(values.get("artifact"), "--artifact");
  return {
    artifactPath,
    manifestPath: required(values.get("manifest"), "--manifest"),
    completionPath: required(values.get("completion"), "--completion"),
  };
}

function readRecoveryTarget(): IsolatedRecoveryEnvironment {
  if (process.env.RIVALHUB_RECOVERY_USE_LOCAL_SUPABASE === "1") {
    const status = readLocalSupabaseStatus();
    const environment = {
      ...process.env,
      DATABASE_URL: status.databaseUrl,
      RIVALHUB_RECOVERY_DATABASE_URL: status.databaseUrl,
    };
    return buildIsolatedRecoveryEnvironment(environment, status);
  }
  return buildIsolatedRecoveryEnvironment(process.env);
}

function readLocalSupabaseStatus() {
  const result = spawnSync(pnpmBin, ["exec", "supabase", "status", "--output", "json"], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) throw new Error("Local Supabase status unavailable; restore aborted. ");
  return parseLocalRecoveryStatus(result.stdout);
}

function assertCompletionMatchesSidecar(
  completion: RecoveryCompletionMarker,
  sidecar: RecoverySidecar,
): void {
  if (
    completion.runId !== sidecar.runId
    || completion.artifactKey !== sidecar.artifactKey
    || completion.artifactSha256 !== sidecar.artifactSha256
    || completion.manifestSha256 !== sidecar.manifestSha256
  ) {
    throw new Error("Recovery completion marker does not match the artifact sidecar; restore aborted. ");
  }
}

function assertArtifactMatchesSidecar(path: string, sidecar: RecoverySidecar): void {
  const stat = statSync(path);
  const checksum = sha256File(path);
  if (stat.size !== sidecar.artifactBytes || checksum !== sidecar.artifactSha256) {
    throw new Error("Encrypted recovery artifact checksum/size mismatch; restore aborted. ");
  }
}

function decryptArtifact(artifactPath: string, archivePath: string): void {
  const identityPath = required(process.env.RIVALHUB_BACKUP_AGE_IDENTITY_FILE, "RIVALHUB_BACKUP_AGE_IDENTITY_FILE");
  const identityStat = statSync(identityPath);
  if (!identityStat.isFile()) throw new Error("RIVALHUB_BACKUP_AGE_IDENTITY_FILE must reference a regular file. ");
  runCommand("age", ["-d", "-i", resolve(identityPath), "-o", archivePath, resolve(artifactPath)]);
}

function extractSafeArchive(archivePath: string, destination: string): void {
  const verbose = runCommandOutput("tar", ["-tvzf", archivePath]);
  for (const line of verbose.split("\n").filter(Boolean)) {
    if (!line.startsWith("-") && !line.startsWith("d")) {
      throw new Error("Recovery archive contains a non-regular entry; restore aborted. ");
    }
  }
  const listing = runCommandOutput("tar", ["-tzf", archivePath]);
  for (const entry of listing.split("\n").map((value) => value.trim()).filter(Boolean)) {
    const normalized = entry.replaceAll("\\", "/");
    const relativeEntry = relative(destination, resolve(destination, normalized));
    if (
      normalized.startsWith("/")
      || relativeEntry === ""
      || relativeEntry.startsWith("..")
      || normalized.includes("/../")
      || !normalized.startsWith("backup/")
    ) {
      throw new Error("Recovery archive path is unsafe; restore aborted. ");
    }
  }
  runCommand("tar", ["-xzf", archivePath, "-C", destination]);
}

function assertManifestCompatibility(manifest: RecoveryManifest): void {
  if (manifest.sourceProjectRef !== PRODUCTION_PROJECT_REF || manifest.database.schemas.join(",") !== "public,auth") {
    throw new Error("Recovery manifest source or schema identity is incompatible; restore aborted. ");
  }
  const sourceTagCommit = resolveReleaseTagCommit(manifest.source.deployedReleaseTag);
  if (sourceTagCommit !== manifest.source.deployedCommit) {
    throw new Error("Recovery manifest deployed source tag does not match its commit; restore aborted. ");
  }
  const currentCommit = readCurrentGitCommit();
  const currentTag = readCurrentReleaseTag();
  if (resolveReleaseTagCommit(currentTag) !== currentCommit || !isCommitAncestor(sourceTagCommit, currentCommit)) {
    throw new Error("Checked-out shipped code is not a compatible descendant of the deployed source release; restore aborted. ");
  }
}

function verifyStagedFiles(stagingRoot: string, manifest: RecoveryManifest): void {
  for (const file of manifest.database.files) {
    const path = resolve(stagingRoot, file.path);
    assertStagedPath(stagingRoot, path);
    if (sha256File(path) !== file.sha256 || statSync(path).size !== file.bytes) {
      throw new Error("Recovery database dump checksum mismatch; restore aborted. ");
    }
  }
  const bucketsPath = resolve(stagingRoot, "storage/buckets.json");
  const indexPath = resolve(stagingRoot, "storage/index.ndjson");
  assertStagedPath(stagingRoot, bucketsPath);
  assertStagedPath(stagingRoot, indexPath);
  if (sha256File(bucketsPath) !== manifest.storage.bucketInventorySha256) {
    throw new Error("Recovery Storage bucket inventory checksum mismatch; restore aborted. ");
  }
  if (sha256File(indexPath) !== manifest.storage.inventorySha256) {
    throw new Error("Recovery Storage object inventory checksum mismatch; restore aborted. ");
  }

  const buckets = readStorageBuckets(bucketsPath);
  const records = readStorageIndex(indexPath);
  if (
    buckets.length !== manifest.storage.bucketCount
    || records.length !== manifest.storage.objectCount
    || records.reduce((total, record) => total + record.bytes, 0) !== manifest.storage.totalBytes
  ) {
    throw new Error("Recovery Storage inventory summary does not match the manifest; restore aborted. ");
  }
  for (const record of records) {
    const objectPath = resolve(stagingRoot, "storage", record.archivePath);
    assertStagedPath(stagingRoot, objectPath);
    const bytes = readFileSync(objectPath);
    if (bytes.byteLength !== record.bytes || sha256File(objectPath) !== record.sha256) {
      throw new Error("Recovery Storage object checksum mismatch; restore aborted. ");
    }
  }
}

function assertSnapshotIdentity(manifest: RecoveryManifest, sidecar: RecoverySidecar): void {
  if (
    manifest.runId !== sidecar.runId
    || manifest.createdAt !== sidecar.createdAt
    || manifest.backupClass !== sidecar.backupClass
    || sidecar.artifactKey !== buildRecoveryR2Keys(manifest.backupClass, manifest.runId, manifest.createdAt).artifact
  ) {
    throw new Error("Recovery manifest does not match the sidecar run identity; restore aborted. ");
  }
}

async function assertRecoveryTargetIsEmpty(pool: Pool, expectedBuckets: readonly StorageBucketRecord[]): Promise<void> {
  // Supabase provider migrations and the migration-owned bucket definition are
  // expected on a fresh local stack; every application/Auth/Storage data row
  // still has to be empty before replay.
  const tables = await pool.query<{ schema_name: string; table_name: string }>(
    `SELECT schemaname AS schema_name, tablename AS table_name
     FROM pg_catalog.pg_tables
     WHERE schemaname = ANY($1::text[])
       AND NOT (schemaname = 'auth' AND tablename = 'schema_migrations')
       AND NOT (schemaname = 'storage' AND tablename = 'migrations')
     ORDER BY schemaname, tablename`,
    [["public", "auth", "storage"]],
  );
  for (const table of tables.rows) {
    if (table.schema_name === "storage" && table.table_name === "buckets") {
      const buckets = await pool.query<{ id: string; name: string }>(
        `SELECT id::text, name FROM ${quoteQualified(table.schema_name, table.table_name)}`,
      );
      const expectedById = new Map(expectedBuckets.map((bucket) => [bucket.id, bucket.name]));
      const expectedByName = new Map(expectedBuckets.map((bucket) => [bucket.name, bucket.id]));
      if (buckets.rows.some((bucket) => expectedById.get(bucket.id) !== bucket.name || expectedByName.get(bucket.name) !== bucket.id)) {
        throw new Error("Recovery target is not empty; use a fresh isolated target and retry. ");
      }
      continue;
    }
    const result = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ${quoteQualified(table.schema_name, table.table_name)}`,
    );
    if (Number(result.rows[0]?.count ?? 0) > 0) {
      throw new Error("Recovery target is not empty; use a fresh isolated target and retry. ");
    }
  }
}

async function ensureTargetMigration(
  pool: Pool,
  manifest: RecoveryManifest,
  databaseUrl: string,
  tempRoot: string,
): Promise<void> {
  const expected = readExpectedMigrations();
  const existing = await readTargetMigration(pool);
  if (existing.length > 0) {
    throw new Error("Recovery target already has Drizzle migrations; use a fresh isolated target and retry. ");
  }
  prepareRecoveryTargetMigration(databaseUrl, manifest.source.databaseMigrationTerminal, tempRoot, expected);
  const actual = await readTargetMigration(pool);
  assertManifestMigrationMatches(
    actual,
    expected,
    manifest.source.databaseMigrationTerminal,
  );
}

async function readTargetMigration(pool: Pick<Pool, "query">): Promise<Migration[]> {
  try {
    const result = await pool.query<Migration>(
      "SELECT hash, created_at::bigint::text AS when FROM drizzle.__drizzle_migrations ORDER BY created_at",
    );
    return result.rows.map((row) => ({ hash: row.hash, when: Number(row.when) }));
  } catch (error) {
    if (isMissingMigrationLedger(error)) return [];
    throw error;
  }
}

function prepareRecoveryTargetMigration(
  databaseUrl: string,
  terminal: RecoveryManifest["source"]["databaseMigrationTerminal"],
  tempRoot: string,
  expected: readonly ExpectedMigration[],
): void {
  const plan = buildRecoveryMigrationPlan(expected, terminal);
  const migrationRoot = join(tempRoot, "migration-prefix");
  const metaRoot = join(migrationRoot, "meta");
  mkdirSync(metaRoot, { recursive: true });
  const sourceMigrationRoot = resolve(projectRoot, "drizzle/migrations");
  const journal = JSON.parse(readFileSync(join(sourceMigrationRoot, "meta/_journal.json"), "utf8")) as {
    entries?: Array<Record<string, unknown>>;
  } & Record<string, unknown>;
  if (!Array.isArray(journal.entries)) throw new Error("Active migration journal is invalid; restore aborted. ");
  for (const migration of plan) {
    copyFileSync(
      join(sourceMigrationRoot, `${migration.tag}.sql`),
      join(migrationRoot, `${migration.tag}.sql`),
    );
  }
  writeFileSync(
    join(metaRoot, "_journal.json"),
    `${JSON.stringify({ ...journal, entries: journal.entries.slice(0, plan.length) }, null, 2)}\n`,
    { flag: "wx" },
  );
  const configPath = join(tempRoot, "drizzle.recovery.config.ts");
  writeFileSync(
    configPath,
    [
      'import type { Config } from "drizzle-kit";',
      `export default { schema: ${JSON.stringify(join(projectRoot, "src/db/schema"))}, out: ${JSON.stringify(migrationRoot)}, dialect: "postgresql", dbCredentials: { url: process.env.RIVALHUB_RECOVERY_DATABASE_URL as string, ssl: false } } satisfies Config;`,
      "",
    ].join("\n"),
    { flag: "wx" },
  );
  runCommand(
    pnpmBin,
    ["exec", "drizzle-kit", "migrate", `--config=${configPath}`],
    { ...process.env, RIVALHUB_RECOVERY_DATABASE_URL: databaseUrl },
  );
}

export async function prepareTargetForDataImport(pool: Pick<Pool, "query">): Promise<string[]> {
  // Query all application tables in public and auth schemas, preserving
  // migration ledger (drizzle.__drizzle_migrations) and provider migration
  // metadata (auth.schema_migrations, storage.migrations).
  const tables = await pool.query<{ schema_name: string; table_name: string }>(
    `SELECT schemaname AS schema_name, tablename AS table_name
     FROM pg_catalog.pg_tables
     WHERE schemaname = ANY($1::text[])
       AND NOT (schemaname = 'auth' AND tablename = 'schema_migrations')
       AND NOT (schemaname = 'storage' AND tablename = 'migrations')
       AND NOT (schemaname = 'drizzle' AND tablename = '__drizzle_migrations')
     ORDER BY schemaname, tablename`,
    [["public", "auth"]],
  );

  if (tables.rows.length === 0) return [];

  const qualifiedTables = tables.rows.map((table) => quoteQualified(table.schema_name, table.table_name));

  // Truncate under replica role with CASCADE so all migration-seeded rows
  // (e.g. 0038 conversion_policies) are cleaned before snapshot import,
  // making the snapshot data the single application truth.
  await pool.query("SET session_replication_role = 'replica'");
  try {
    await pool.query(`TRUNCATE TABLE ${qualifiedTables.join(", ")} CASCADE`);
  } finally {
    await pool.query("SET session_replication_role = 'origin'");
  }

  return tables.rows.map((table) => `${table.schema_name}.${table.table_name}`);
}

export function applyDatabaseData(databaseUrl: string, dataPath: string, tempRoot: string): void {
  // Supabase restore semantics: import with session_replication_role=replica
  // in a single transaction, then restore to origin/default.
  const wrapperScriptPath = join(tempRoot, "restore-import-wrapper.sql");
  const absoluteDataPath = resolve(dataPath).replaceAll("\\", "/");
  writeFileSync(
    wrapperScriptPath,
    [
      "SET session_replication_role = 'replica';",
      `\\i '${absoluteDataPath}'`,
      "SET session_replication_role = 'origin';",
      "",
    ].join("\n"),
    { flag: "wx" },
  );
  runCommand("psql", [
    "--dbname", databaseUrl,
    "--set", "ON_ERROR_STOP=1",
    "--single-transaction",
    "--file", wrapperScriptPath,
  ]);
}

function runLifecycleReconciliation(target: IsolatedRecoveryEnvironment): void {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: target.databaseUrl,
    NEXT_PUBLIC_SUPABASE_URL: target.supabase.apiUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: target.supabase.publishableKey,
    SUPABASE_SERVICE_ROLE_KEY: target.supabase.serviceRoleKey,
    RIVALHUB_RECOVERY_DATABASE_URL: target.databaseUrl,
    RIVALHUB_RECOVERY_SUPABASE_URL: target.supabase.apiUrl,
    RIVALHUB_RECOVERY_PUBLISHABLE_KEY: target.supabase.publishableKey,
    RIVALHUB_RECOVERY_SERVICE_ROLE_KEY: target.supabase.serviceRoleKey,
    RIVALHUB_RECOVERY_TARGET: "isolated",
    RIVALHUB_DB_TARGET: "local",
  };
  delete environment.RIVALHUB_ALLOW_REMOTE_DB_WRITE;
  const result = spawnSync(pnpmBin, ["exec", "tsx", "scripts/db/recovery/lifecycle.ts"], {
    cwd: projectRoot,
    env: environment,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) throw new Error("Recovery lifecycle reconciliation failed; restore aborted. ");
}

function readJson<T>(path: string, parser: (value: unknown) => T): T {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error("Recovery manifest JSON is invalid; restore aborted. ");
  }
  return parser(value);
}

function assertStagedPath(root: string, path: string): void {
  const pathFromRoot = relative(resolve(root), resolve(path));
  if (!pathFromRoot || pathFromRoot.startsWith("..")) throw new Error("Recovery staging path is unsafe; restore aborted. ");
}

function readCurrentGitCommit(): string {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: projectRoot, encoding: "utf8" });
  if (result.status !== 0 || !/^[0-9a-f]{40}$/i.test(result.stdout.trim())) throw new Error("Checked-out git identity unavailable; restore aborted. ");
  return result.stdout.trim();
}

function readCurrentReleaseTag(): string {
  const configured = process.env.RIVALHUB_RECOVERY_APPLICATION_TAG?.trim();
  if (configured) {
    if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(configured)) {
      throw new Error("RIVALHUB_RECOVERY_APPLICATION_TAG 必须是 shipped release tag。 ");
    }
    return configured;
  }
  const result = spawnSync("git", ["tag", "--points-at", "HEAD", "--list", "v*"], { cwd: projectRoot, encoding: "utf8" });
  const tag = result.stdout.split(/\r?\n/).map((value) => value.trim()).find((value) => /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value));
  if (result.status !== 0 || !tag) throw new Error("Restore must run from an exact shipped release tag; restore aborted. ");
  return tag;
}

function resolveReleaseTagCommit(tag: string): string {
  const result = spawnSync("git", ["rev-parse", `refs/tags/${tag}^{commit}`], { cwd: projectRoot, encoding: "utf8" });
  const commit = result.stdout.trim();
  if (result.status !== 0 || !/^[0-9a-f]{40}$/i.test(commit)) {
    throw new Error("Recovery release tag cannot be resolved locally; restore aborted. ");
  }
  return commit;
}

function isCommitAncestor(ancestor: string, descendant: string): boolean {
  const result = spawnSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], { cwd: projectRoot, encoding: "utf8" });
  return result.status === 0;
}

function isMissingMigrationLedger(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return code === "42P01" || code === "3F000";
}

function runCommand(executable: string, args: readonly string[], env: NodeJS.ProcessEnv = process.env): void {
  const result = spawnSync(executable, [...args], {
    cwd: projectRoot,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0 || result.signal) throw new Error(`${executable} recovery operation failed; restore aborted. `);
}

function runCommandOutput(executable: string, args: readonly string[]): string {
  const result = spawnSync(executable, [...args], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0 || result.signal) throw new Error(`${executable} recovery operation failed; restore aborted. `);
  return result.stdout;
}

function required(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new Error(`${name} 未设置；restore aborted. `);
  return value.trim();
}

function quoteQualified(schema: string, table: string): string {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

if (process.argv[1]?.endsWith("restore.ts")) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Recovery restore failed.");
    process.exitCode = 1;
  });
}
