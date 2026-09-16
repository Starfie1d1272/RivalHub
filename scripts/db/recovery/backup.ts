import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { Pool } from "pg";
import {
  assertBackupClass,
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
import { resolveProductionSourceIdentity } from "./source";
import {
  assertActiveChainPrefix,
  readExpectedMigrations,
  type Migration,
} from "../production-preflight";

const projectRoot = resolve(process.cwd());
const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

async function main(): Promise<void> {
  const backupClass = assertBackupClass(process.argv[2] ?? process.env.RIVALHUB_BACKUP_CLASS);
  const environment = assertProductionBackupEnvironment(process.env);
  const runId = randomUUID();
  const createdAt = new Date().toISOString();
  const tempRoot = mkdtempSync(join(tmpdir(), `rivalhub-recovery-${runId}-`));
  const stagingRoot = join(tempRoot, "backup");
  mkdirSync(stagingRoot, { recursive: true });

  try {
    const supabaseCliVersion = readSupabaseCliVersion();
    const migration = await readProductionMigrationIdentity(environment.databaseUrl);
    const source = await resolveProductionSourceIdentity();
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

    const manifest: RecoveryManifest = {
      formatVersion: RECOVERY_FORMAT_VERSION,
      runId,
      createdAt,
      sourceEnvironment: "production",
      sourceProjectRef: PRODUCTION_PROJECT_REF,
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
      },
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

    console.log(
      `Production backup complete: class=${backupClass}, run=${runId}, artifactBytes=${artifact.artifactBytes}, storageObjects=${storage.objectCount}, storageBytes=${storage.totalBytes}, artifactSha256=${artifact.artifactSha256}.`,
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
  runSupabaseDump(databaseUrl, ["--role-only"], rolesPath);
  runSupabaseDump(databaseUrl, ["--schema", "public"], schemaPath);
  runSupabaseDump(databaseUrl, ["--data-only", "--use-copy", "--schema", "public,auth"], dataPath);
  return {
    roles: digestFile(rolesPath, "roles.sql"),
    schema: digestFile(schemaPath, "schema.sql"),
    data: digestFile(dataPath, "data.sql"),
  };
}

function runSupabaseDump(databaseUrl: string, flags: readonly string[], outputPath: string): void {
  runCommand(
    pnpmBin,
    [
      "exec",
      "supabase",
      "db",
      "dump",
      "--db-url",
      databaseUrl,
      "--file",
      outputPath,
      ...flags,
    ],
  );
}

export async function readProductionMigrationIdentity(databaseUrl: string): Promise<{
  postgresVersion: string;
  ledger: RecoveryManifest["source"]["databaseMigrationTerminal"];
}> {
  const expected = readExpectedMigrations();
  const pool = new Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false }, max: 1 });
  try {
    const version = await pool.query<{ server_version: string }>("SHOW server_version");
    const ledgerResult = await pool.query<Migration>(
      "SELECT hash, created_at::bigint::text AS when FROM drizzle.__drizzle_migrations ORDER BY created_at",
    );
    const actual = ledgerResult.rows.map((row) => ({ hash: row.hash, when: Number(row.when) }));
    assertActiveChainPrefix(actual, expected);
    const terminal = actual.at(-1);
    const expectedTerminal = expected[actual.length - 1];
    if (!terminal || !expectedTerminal) throw new Error("Production migration ledger is empty or unknown; backup aborted. ");
    return {
      postgresVersion: version.rows[0]?.server_version ?? "unknown",
      ledger: {
        terminalHash: terminal.hash,
        terminalTag: expectedTerminal.tag,
        terminalWhen: terminal.when,
      },
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
  const pool = new Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false }, max: 1 });
  try {
    return await readManagedStorageReferences(pool);
  } finally {
    await pool.end();
  }
}

function runCommand(executable: string, args: readonly string[]): void {
  const result = spawnSync(executable, [...args], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0 || result.signal) {
    throw new Error(`${executable} recovery operation failed; canonical backup aborted. `);
  }
}

if (process.argv[1]?.endsWith("backup.ts")) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Production backup failed.");
    process.exitCode = 1;
  });
}
