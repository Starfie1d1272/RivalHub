import { randomUUID } from "node:crypto";
import { lstatSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { publishRecoveryArtifact } from "./artifact";
import {
  assertProductionDbCheckpointEnvironment,
  assertIsolatedInstanceBackupEnvironment,
  assertInstanceBackupEnvironment,
  PRODUCTION_PROJECT_REF,
} from "./environment";
import {
  RECOVERY_FORMAT_VERSION,
  type RecoveryManifest,
} from "./manifest";
import {
  createDatabaseSnapshot,
  readGitCommit,
  readPackageVersion,
  readProductionMigrationIdentity,
  readSupabaseCliVersion,
} from "./backup";
import { assertInstanceReleaseIdentity, assertRecoverySourceUnchanged, resolveInstanceSourceIdentity, resolveProductionSourceIdentity } from "./source";

async function main(): Promise<void> {
  const sourceMode = process.env.RIVALHUB_BACKUP_SOURCE ?? "production";
  if (sourceMode !== "production" && sourceMode !== "instance" && sourceMode !== "isolated-instance") throw new Error("Unknown DB checkpoint source.");
  const instanceEnv = { ...process.env };
  if (sourceMode === "instance" && instanceEnv.DATABASE_URL) {
    const db = new URL(instanceEnv.DATABASE_URL);
    if (db.hostname.endsWith(".pooler.supabase.com") && db.port === "6543") {
      db.port = "5432";
      db.searchParams.delete("pgbouncer");
      instanceEnv.DATABASE_URL = db.toString();
    }
  }
  const instance = sourceMode === "instance" ? assertInstanceBackupEnvironment(instanceEnv)
    : sourceMode === "isolated-instance" ? assertIsolatedInstanceBackupEnvironment(process.env) : undefined;
  const environment = instance ?? assertProductionDbCheckpointEnvironment(process.env);
  // The installer captures this response from the verified running process under
  // its host lock immediately before stopping it. Never accept an env identity.
  const frozenPath = process.argv[2] === "--stopped-instance-source" ? process.argv[3] : undefined;
  if (process.argv.length > 2 && (!instance || !frozenPath || process.argv.length !== 4)) throw new Error("Invalid checkpoint arguments.");
  if (frozenPath) {
    const file = lstatSync(frozenPath), parent = statSync(dirname(frozenPath));
    if (process.getuid?.() !== 0 || !file.isFile() || file.isSymbolicLink() || file.uid !== 0 || parent.uid !== 0
      || (file.mode & 0o077) || (parent.mode & 0o077) || file.size > 65536) throw new Error("Protected stopped-instance source required.");
  }
  const readSource = async () => {
    if (!frozenPath) return instance ? resolveInstanceSourceIdentity(instance.appOrigin, instance.supabaseUrl, process.cwd(), fetch, sourceMode === "isolated-instance") : resolveProductionSourceIdentity();
    const record = JSON.parse(readFileSync(frozenPath, "utf8"));
    if (Object.keys(record).sort().join(",") !== "databaseName,releaseCommit,releaseTag,supabaseUrl"
      || record.supabaseUrl !== instance!.supabaseUrl || record.databaseName !== "postgres") throw new Error("Frozen source database identity differs.");
    assertInstanceReleaseIdentity(record.releaseTag, record.releaseCommit);
    return { deployedReleaseTag: record.releaseTag, deployedCommit: record.releaseCommit };
  };
  const runId = randomUUID();
  const createdAt = new Date().toISOString();
  const tempRoot = mkdtempSync(join(tmpdir(), `rivalhub-release-db-checkpoint-${runId}-`));
  const stagingRoot = join(tempRoot, "backup");
  mkdirSync(stagingRoot, { recursive: true });

  try {
    const migration = await readProductionMigrationIdentity(environment.databaseUrl);
    const source = await readSource();
    const databaseRoot = await createDatabaseSnapshot(environment.databaseUrl, stagingRoot);
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
      supabaseCliVersion: readSupabaseCliVersion(),
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
      artifactKind: "db-checkpoint",
      backupClass: "release-db",
      database: {
        schemas: ["public", "auth"],
        files: [databaseRoot.roles, databaseRoot.schema, databaseRoot.data],
      },
    };

    const artifact = publishRecoveryArtifact({
      environment,
      backupClass: "release-db",
      runId,
      createdAt,
      tempRoot,
      stagingRoot,
      manifest,
    });
    console.log(
      `DB checkpoint complete: class=release-db, run=${runId}, completion=${artifact.keys.completion}, artifactBytes=${artifact.artifactBytes}, artifactSha256=${artifact.artifactSha256}.`,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Production DB checkpoint failed.");
  process.exitCode = 1;
});
