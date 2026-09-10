import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  serializeCompletionMarker,
  serializeManifest,
  serializeSidecar,
  sha256File,
  type RecoveryCompletionMarker,
  type RecoveryManifest,
  type RecoverySidecar,
} from "./manifest";
import { buildRecoveryR2Keys, createR2Client, assertR2ContentReadback, assertR2HeadReadback } from "./r2";
import { snapshotStorage, assertActiveStorageReferencesCaptured } from "./storage";
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
    const databaseRoot = await createDatabaseSnapshot(environment.databaseUrl, stagingRoot);
    const storage = await snapshotStorage(
      createClient(environment.supabaseUrl, environment.serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      }),
      join(stagingRoot, "storage"),
    );
    assertActiveStorageReferencesCaptured(
      await readActiveStorageReferences(environment.databaseUrl),
      storage.records,
    );

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

    const manifestPath = join(stagingRoot, "manifest.json");
    writeFileSync(manifestPath, serializeManifest(manifest), { flag: "wx" });
    const archivePath = join(tempRoot, `${runId}.tar.gz`);
    runCommand("tar", ["-czf", archivePath, "-C", tempRoot, "backup"]);
    const artifactPath = join(tempRoot, `${runId}.tar.gz.age`);
    runCommand("age", ["-r", environment.ageRecipient, "-o", artifactPath, archivePath]);

    const artifactBytes = readFileSync(artifactPath).byteLength;
    const artifactSha256 = sha256File(artifactPath);
    const manifestSha256 = sha256File(manifestPath);
    const keys = buildRecoveryR2Keys(backupClass, runId, createdAt);
    const sidecarPath = join(tempRoot, `${runId}.manifest.json`);
    const sidecar: RecoverySidecar = {
      formatVersion: RECOVERY_FORMAT_VERSION,
      runId,
      artifactKey: keys.artifact,
      artifactBytes,
      artifactSha256,
      manifestSha256,
      createdAt,
      backupClass,
    };
    writeFileSync(sidecarPath, serializeSidecar(sidecar), { flag: "wx" });
    const sidecarSha256 = sha256File(sidecarPath);

    const completionPath = join(tempRoot, `${runId}.complete.json`);
    const completion: RecoveryCompletionMarker = {
      formatVersion: RECOVERY_FORMAT_VERSION,
      runId,
      artifactKey: keys.artifact,
      artifactSha256,
      manifestSha256,
      completedAt: new Date().toISOString(),
    };
    writeFileSync(completionPath, serializeCompletionMarker(completion), { flag: "wx" });

    const r2 = createR2Client(environment.r2);
    r2.put(artifactPath, keys.artifact, {
      contentType: "application/octet-stream",
      metadata: { sha256: artifactSha256, "run-id": runId, "backup-class": backupClass },
    });
    verifyR2Object(r2, keys.artifact, artifactPath, join(tempRoot, "artifact.readback"));

    r2.put(sidecarPath, keys.manifest, {
      contentType: "application/json",
      metadata: { sha256: sidecarSha256, "run-id": runId, "backup-class": backupClass },
    });
    verifyR2Object(r2, keys.manifest, sidecarPath, join(tempRoot, "manifest.readback"));

    const completionSha256 = sha256File(completionPath);
    r2.put(completionPath, keys.completion, {
      contentType: "application/json",
      metadata: { sha256: completionSha256, "run-id": runId, "backup-class": backupClass },
    });
    verifyR2Object(r2, keys.completion, completionPath, join(tempRoot, "completion.readback"));

    console.log(
      `Production backup complete: class=${backupClass}, run=${runId}, artifactBytes=${artifactBytes}, storageObjects=${storage.objectCount}, storageBytes=${storage.totalBytes}, artifactSha256=${artifactSha256}.`,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function createDatabaseSnapshot(
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

async function readProductionMigrationIdentity(databaseUrl: string): Promise<{
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

function readSupabaseCliVersion(): string {
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

function readPackageVersion(): string {
  const packageJson = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8")) as { version?: unknown };
  if (typeof packageJson.version !== "string" || !packageJson.version) throw new Error("package.json version is invalid; backup aborted. ");
  return packageJson.version;
}

function readGitCommit(): string {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: projectRoot, encoding: "utf8" });
  if (result.status !== 0 || !/^[0-9a-f]{40}$/i.test(result.stdout.trim())) throw new Error("Git commit identity unavailable; backup aborted. ");
  return result.stdout.trim();
}

async function readActiveStorageReferences(databaseUrl: string): Promise<ReadonlyArray<{ bucket: string; objectPath: string }>> {
  const pool = new Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false }, max: 1 });
  try {
    const result = await pool.query<{ evidence_object_key: string }>(
      "SELECT evidence_object_key FROM public.education_verifications WHERE evidence_object_key IS NOT NULL",
    );
    return result.rows.map((row) => ({ bucket: "education-evidence", objectPath: row.evidence_object_key }));
  } finally {
    await pool.end();
  }
}

function verifyR2Object(
  r2: ReturnType<typeof createR2Client>,
  key: string,
  localPath: string,
  readbackPath: string,
): void {
  const expected = { bytes: readFileSync(localPath).byteLength, sha256: sha256File(localPath) };
  assertR2HeadReadback(r2.head(key), expected);
  r2.download(key, readbackPath);
  assertR2ContentReadback(readbackPath, expected);
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
