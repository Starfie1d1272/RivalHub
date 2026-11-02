import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import { assertRecoverySourceUnchanged, resolveInstanceSourceIdentity, resolveProductionSourceIdentity, resolveStoppedInstanceSourceIdentity } from "./source";

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
  const sourceManifest = process.argv[4] === "--source-manifest" ? process.argv[5] : undefined;
  if (process.argv.length > 2 && (!instance || !frozenPath || !sourceManifest || process.argv.length !== 6)) throw new Error("Invalid checkpoint arguments.");
  const readSource = async () => frozenPath
    ? resolveStoppedInstanceSourceIdentity(frozenPath, sourceManifest!, instance!.supabaseUrl, environment.databaseUrl)
    : instance ? resolveInstanceSourceIdentity(instance.appOrigin, instance.supabaseUrl, process.cwd(), fetch, sourceMode === "isolated-instance") : resolveProductionSourceIdentity();
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
