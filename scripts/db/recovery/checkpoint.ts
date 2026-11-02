import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publishRecoveryArtifact } from "./artifact";
import {
  assertProductionDbCheckpointEnvironment,
  assertIsolatedInstanceBackupEnvironment,
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
import { assertRecoverySourceUnchanged, resolveInstanceSourceIdentity, resolveProductionSourceIdentity } from "./source";

async function main(): Promise<void> {
  const sourceMode = process.env.RIVALHUB_BACKUP_SOURCE ?? "production";
  if (sourceMode !== "production" && sourceMode !== "isolated-instance") throw new Error("DB checkpoint supports production or isolated-instance only.");
  const isolated = sourceMode === "isolated-instance" ? assertIsolatedInstanceBackupEnvironment(process.env) : undefined;
  const environment = isolated ?? assertProductionDbCheckpointEnvironment(process.env);
  const readSource = () => isolated ? resolveInstanceSourceIdentity(isolated.appOrigin, isolated.supabaseUrl, process.cwd(), fetch, true) : resolveProductionSourceIdentity();
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
      sourceProjectRef: isolated?.projectRef ?? PRODUCTION_PROJECT_REF,
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
      `DB checkpoint complete: class=release-db, run=${runId}, artifactBytes=${artifact.artifactBytes}, artifactSha256=${artifact.artifactSha256}.`,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Production DB checkpoint failed.");
  process.exitCode = 1;
});
