import { randomUUID, createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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
    const storage = createEmptyStorageSnapshot(stagingRoot);
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
      backupClass: "release-db",
      database: {
        schemas: ["public", "auth"],
        files: [databaseRoot.roles, databaseRoot.schema, databaseRoot.data],
      },
      storage,
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

function createEmptyStorageSnapshot(stagingRoot: string): RecoveryManifest["storage"] {
  const storageRoot = join(stagingRoot, "storage");
  mkdirSync(join(storageRoot, "objects"), { recursive: true });
  const buckets = "[]\n";
  const index = "";
  writeFileSync(join(storageRoot, "buckets.json"), buckets, { flag: "wx" });
  writeFileSync(join(storageRoot, "index.ndjson"), index, { flag: "wx" });
  return {
    bucketCount: 0,
    bucketInventorySha256: createHash("sha256").update(buckets).digest("hex"),
    objectCount: 0,
    totalBytes: 0,
    inventorySha256: createHash("sha256").update(index).digest("hex"),
  };
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Production DB checkpoint failed.");
  process.exitCode = 1;
});
