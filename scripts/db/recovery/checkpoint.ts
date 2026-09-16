import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publishRecoveryArtifact } from "./artifact";
import {
  assertProductionDbCheckpointEnvironment,
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
import { resolveProductionSourceIdentity } from "./source";

async function main(): Promise<void> {
  const environment = assertProductionDbCheckpointEnvironment(process.env);
  const runId = randomUUID();
  const createdAt = new Date().toISOString();
  const tempRoot = mkdtempSync(join(tmpdir(), `rivalhub-release-db-checkpoint-${runId}-`));
  const stagingRoot = join(tempRoot, "backup");
  mkdirSync(stagingRoot, { recursive: true });

  try {
    const migration = await readProductionMigrationIdentity(environment.databaseUrl);
    const source = await resolveProductionSourceIdentity();
    const databaseRoot = await createDatabaseSnapshot(environment.databaseUrl, stagingRoot);
    const manifest: RecoveryManifest = {
      formatVersion: RECOVERY_FORMAT_VERSION,
      runId,
      createdAt,
      sourceEnvironment: "production",
      sourceProjectRef: PRODUCTION_PROJECT_REF,
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
      `Production DB checkpoint complete: class=release-db, run=${runId}, artifactBytes=${artifact.artifactBytes}, artifactSha256=${artifact.artifactSha256}.`,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Production DB checkpoint failed.");
  process.exitCode = 1;
});
