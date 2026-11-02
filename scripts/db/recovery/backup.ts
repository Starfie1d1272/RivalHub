import { assertV2LedgerPrefix, readLegacyLineage, readV2Migrations, type LegacyLedgerEntry } from "../legacy-lineage";
import { isMigrationLedgerPrefix } from "../migration-ledger";
import { runVerifiedSupabaseDump } from "./verified-dump";
import { postgresConnection } from "../../../src/db/postgres-connection";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { Pool } from "pg";
import {
  assertBackupClass,
  assertInstanceBackupEnvironment,
  assertIsolatedInstanceBackupEnvironment,
  assertProductionBackupEnvironment,
  PRODUCTION_PROJECT_REF,
} from "./environment";
import {
  RECOVERY_FORMAT_VERSION,
  digestFile,
  type RecoveryManifest,
} from "./manifest";
import { publishRecoveryArtifact } from "./artifact";
import {
  assertActiveStorageReferencesCaptured,
  assertActiveStorageReferencesStable,
  snapshotStorage,
} from "./storage";
import { readManagedStorageReferences, type ManagedStorageReference } from "./storage-policy";
import { assertRecoverySourceUnchanged, assertV2FullRecoverySupported, resolveInstanceSourceIdentity, resolveProductionSourceIdentity, resolveStoppedInstanceSourceIdentity } from "./source";
import {
  readExpectedMigrations,
} from "../production-preflight";

const projectRoot = resolve(process.cwd());
const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

async function main(): Promise<void> {
  const stopped = process.argv[2] === "--stopped-instance-source";
  if (stopped && (process.argv.length !== 6 || process.argv[4] !== "--source-manifest")) throw new Error("Invalid stopped-instance backup arguments.");
  const backupClass = assertBackupClass(stopped ? process.env.RIVALHUB_BACKUP_CLASS : process.argv[2] ?? process.env.RIVALHUB_BACKUP_CLASS);
  const sourceMode = process.env.RIVALHUB_BACKUP_SOURCE ?? "production";
  if (sourceMode !== "production" && sourceMode !== "instance" && sourceMode !== "isolated-instance") throw new Error("Unknown backup source.");
  const instance = sourceMode === "instance" ? assertInstanceBackupEnvironment(process.env)
    : sourceMode === "isolated-instance" ? assertIsolatedInstanceBackupEnvironment(process.env) : undefined;
  const environment = instance ?? assertProductionBackupEnvironment(process.env);
  let frozenPath: string | undefined, sourceManifest: string | undefined, stoppedSnapshot: string | undefined;
  if (stopped) {
    if (sourceMode !== "instance" || !instance) throw new Error("Stopped full backup requires an instance source.");
    const snapshot = realpathSync(readFileSync("/opt/rivalhub-instance/previous-snapshot", "utf8").trim());
    stoppedSnapshot = snapshot;
    frozenPath = realpathSync(process.argv[3]!);
    sourceManifest = realpathSync(process.argv[5]!);
    const current = realpathSync("/opt/rivalhub-instance/current");
    if (!snapshot.startsWith("/opt/rivalhub-instance/rollback/") || frozenPath !== `${snapshot}/running-source.json`
      || sourceManifest !== `${current}/standby.json`) throw new Error("Invalid stopped-instance transaction.");
    const lock = spawnSync("flock", ["-n", "/opt/rivalhub-instance/deploy.lock", "true"]);
    const service = spawnSync("systemctl", ["is-active", "--quiet", "rivalhub-instance"]);
    if (lock.error || lock.status !== 1 || service.error || service.status !== 3) throw new Error("Stopped backup requires the held host lock and stopped service.");
  }
  const readSource = () => frozenPath
    ? resolveStoppedInstanceSourceIdentity(frozenPath, sourceManifest!, instance!.supabaseUrl, environment.databaseUrl, false)
    : instance ? resolveInstanceSourceIdentity(instance.appOrigin, instance.supabaseUrl, projectRoot, fetch, sourceMode === "isolated-instance") : resolveProductionSourceIdentity();
  const runId = randomUUID();
  const createdAt = new Date().toISOString();
  const tempRoot = mkdtempSync(join(tmpdir(), `rivalhub-recovery-${runId}-`));
  const stagingRoot = join(tempRoot, "backup");
  mkdirSync(stagingRoot, { recursive: true });

  try {
    const supabaseCliVersion = readSupabaseCliVersion();
    const migration = await readProductionMigrationIdentity(environment.databaseUrl);
    if (migration.lineage === "v2") assertV2FullRecoverySupported(migration.ledger.terminalTag);
    const source = await readSource();
    const activeStorageReferencesBeforeSnapshot = await readManagedStorageReferencesFromProduction(environment.databaseUrl);
    const dbDumpStart = performance.now();
    const databaseRoot = await createDatabaseSnapshot(environment.databaseUrl, stagingRoot);
    const dbDumpDuration = Math.round(performance.now() - dbDumpStart);
    console.log(`timing DB dump: ${dbDumpDuration}ms`);

    const storageStart = performance.now();
    const storage = await snapshotStorage(
      createClient(environment.supabaseUrl, environment.supabaseSecretKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      }),
      join(stagingRoot, "storage"),
    );
    const storageDuration = Math.round(performance.now() - storageStart);
    console.log(`timing Storage snapshot: ${storageDuration}ms`);
    const activeStorageReferencesAfterSnapshot = await readManagedStorageReferencesFromProduction(environment.databaseUrl);
    assertActiveStorageReferencesStable(activeStorageReferencesBeforeSnapshot, activeStorageReferencesAfterSnapshot);
    assertActiveStorageReferencesCaptured(activeStorageReferencesBeforeSnapshot, storage.records);

    // A snapshot is not a migration mutex. Re-read both independently sourced
    // identities before publishing so a changed release/chain fails closed.
    const migrationAfter = await readProductionMigrationIdentity(environment.databaseUrl);
    const sourceAfter = await readSource();
    assertRecoverySourceUnchanged(
      { ...source, databaseMigrationTerminal: migration.ledger, migrationLineage: migration.lineage, v2MigrationLedger: migration.v2Ledger, legacyMigrationLedger: migration.legacyLedger },
      { ...sourceAfter, databaseMigrationTerminal: migrationAfter.ledger, migrationLineage: migrationAfter.lineage, v2MigrationLedger: migrationAfter.v2Ledger, legacyMigrationLedger: migrationAfter.legacyLedger },
    );

    const manifest: RecoveryManifest = {
      formatVersion: RECOVERY_FORMAT_VERSION,
      runId,
      createdAt,
      sourceEnvironment: sourceMode,
      sourceProjectRef: instance?.projectRef ?? PRODUCTION_PROJECT_REF,
      postgresVersion: migration.postgresVersion,
      supabaseCliVersion,
      producer: {
        recoveryFormatVersion: RECOVERY_FORMAT_VERSION,
        gitCommit: readGitCommit(),
        packageVersion: readPackageVersion(),
      },
      source: {
        ...source,
        databaseMigrationTerminal: migration.ledger,
        migrationLineage: migration.lineage,
        ...(migration.v2Ledger ? { v2MigrationLedger: migration.v2Ledger } : {}),
        ...(migration.legacyLedger ? { legacyMigrationLedger: migration.legacyLedger } : {}),
      },
      artifactKind: "full",
      backupClass,
      database: {
        schemas: ["public", "auth"],
        files: [
          databaseRoot.roles,
          databaseRoot.schema,
          databaseRoot.data,
        ],
      },
      storage: {
        bucketCount: storage.bucketCount,
        bucketInventorySha256: storage.bucketInventorySha256,
        objectCount: storage.objectCount,
        totalBytes: storage.totalBytes,
        inventorySha256: storage.inventorySha256,
      },
    };

    const artifact = publishRecoveryArtifact({
      environment,
      backupClass,
      runId,
      createdAt,
      tempRoot,
      stagingRoot,
      manifest,
    });

    if (stoppedSnapshot) {
      const [candidateTag, candidateCommit, sourceTag, sourceCommit, ...extra] = readFileSync(join(stoppedSnapshot, "identity"), "utf8").trim().split(/\s+/);
      if (extra.length || !candidateTag || !/^[a-f0-9]{40}$/.test(candidateCommit ?? "")
        || sourceTag !== source.deployedReleaseTag || sourceCommit !== source.deployedCommit) throw new Error("Stopped transaction identity differs from checkpoint source.");
      // Written only after artifact, sidecar and completion have passed real GET/hash read-back.
      // The enclosing root-only transaction binds this receipt to the candidate and DB target.
      writeFileSync(join(stoppedSnapshot, "full-checkpoint.json"), `${JSON.stringify({
        version: 1, candidate: { tag: candidateTag, commit: candidateCommit },
        source: manifest.source, sourceProjectRef: manifest.sourceProjectRef,
        sourceManifestSha256: createHash("sha256").update(readFileSync(sourceManifest!)).digest("hex"),
        target: { supabaseUrl: environment.supabaseUrl, databaseName: decodeURI(new URL(environment.databaseUrl).pathname.slice(1)) },
        runId, artifactSha256: artifact.artifactSha256, manifestSha256: artifact.manifestSha256,
        completionKey: artifact.keys.completion, storage: manifest.storage,
      })}\n`, { flag: "wx", mode: 0o600 });
    }
    console.log(
      `Recovery backup complete: class=${backupClass}, run=${runId}, completion=${artifact.keys.completion}, artifactBytes=${artifact.artifactBytes}, storageObjects=${storage.objectCount}, storageBytes=${storage.totalBytes}, artifactSha256=${artifact.artifactSha256}.`,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

export async function createDatabaseSnapshot(
  databaseUrl: string,
  stagingRoot: string,
): Promise<{ roles: ReturnType<typeof digestFile>; schema: ReturnType<typeof digestFile>; data: ReturnType<typeof digestFile> }> {
  const rolesPath = join(stagingRoot, "roles.sql");
  const schemaPath = join(stagingRoot, "schema.sql");
  const dataPath = join(stagingRoot, "data.sql");
  runVerifiedSupabaseDump(databaseUrl, ["--role-only"], rolesPath);
  runVerifiedSupabaseDump(databaseUrl, ["--schema", "public"], schemaPath);
  runVerifiedSupabaseDump(databaseUrl, ["--data-only", "--use-copy", "--schema", "public,auth"], dataPath);
  return {
    roles: digestFile(rolesPath, "roles.sql"),
    schema: digestFile(schemaPath, "schema.sql"),
    data: digestFile(dataPath, "data.sql"),
  };
}

export async function readProductionMigrationIdentity(databaseUrl: string): Promise<{
  postgresVersion: string;
  ledger: RecoveryManifest["source"]["databaseMigrationTerminal"];
  lineage: "v2" | "v3";
  v2Ledger?: LegacyLedgerEntry[];
  legacyLedger?: LegacyLedgerEntry[];
}> {
  const expected = readExpectedMigrations();
  const pool = new Pool({ ...postgresConnection(databaseUrl), max: 1 });
  try {
    const version = await pool.query<{ server_version: string }>("SHOW server_version");
    const ledgerResult = await pool.query<{ id: number; hash: string; when: string }>(
      "SELECT id, hash, created_at::bigint::text AS \"when\" FROM drizzle.__drizzle_migrations ORDER BY created_at, id",
    );
    const actual = ledgerResult.rows.map((row) => ({ id: row.id, hash: row.hash, when: Number(row.when) }));
    if (!actual.length) throw new Error("Migration ledger is empty; backup aborted.");
    const active = isMigrationLedgerPrefix(actual, expected);
    let terminal = expected[actual.length - 1];
    let v2Ledger: LegacyLedgerEntry[] | undefined;
    let legacyLedger: LegacyLedgerEntry[] | undefined;
    if (active) {
      legacyLedger = await readLegacyLineage(pool);
    } else {
      assertV2LedgerPrefix(actual);
      const relation = await pool.query<{ archive: string | null }>("SELECT to_regclass('drizzle.__rivalhub_legacy_migrations')::text AS archive");
      if (relation.rows[0]?.archive) throw new Error("V2 ledger has an unexpected V3 archive; backup aborted.");
      terminal = readV2Migrations()[actual.length - 1];
      v2Ledger = actual;
    }
    if (!terminal) throw new Error("Migration ledger terminal is unknown; backup aborted.");
    return {
      postgresVersion: version.rows[0]?.server_version ?? "unknown",
      lineage: active ? "v3" : "v2",
      ...(v2Ledger ? { v2Ledger } : {}),
      ...(legacyLedger ? { legacyLedger } : {}),
      ledger: { terminalHash: terminal.hash, terminalTag: terminal.tag, terminalWhen: terminal.when },
    };
  } finally {
    await pool.end();
  }
}

export function readSupabaseCliVersion(): string {
  const result = spawnSync(pnpmBin, ["exec", "supabase", "--version"], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) throw new Error("Supabase CLI version could not be determined; backup aborted. ");
  const version = result.stdout.trim().split(/\s+/).at(-1);
  if (!version || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error("Supabase CLI version output is invalid; backup aborted. ");
  }
  return version;
}

export function readPackageVersion(): string {
  const packageJson = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8")) as { version?: unknown };
  if (typeof packageJson.version !== "string" || !packageJson.version) throw new Error("package.json version is invalid; backup aborted. ");
  return packageJson.version;
}

export function readGitCommit(): string {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: projectRoot, encoding: "utf8" });
  if (result.status !== 0 || !/^[0-9a-f]{40}$/i.test(result.stdout.trim())) throw new Error("Git commit identity unavailable; backup aborted. ");
  return result.stdout.trim();
}

async function readManagedStorageReferencesFromProduction(databaseUrl: string): Promise<readonly ManagedStorageReference[]> {
  const pool = new Pool({ ...postgresConnection(databaseUrl), max: 1 });
  try {
    return await readManagedStorageReferences(pool);
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.endsWith("backup.ts")) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Production backup failed.");
    process.exitCode = 1;
  });
}
