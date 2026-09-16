import { performance } from "node:perf_hooks";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ProductionBackupEnvironment, RecoveryArtifactClass } from "./environment";
import {
  RECOVERY_FORMAT_VERSION,
  serializeCompletionMarker,
  serializeManifest,
  serializeSidecar,
  sha256File,
  type RecoveryCompletionMarker,
  type RecoveryManifest,
  type RecoverySidecar,
} from "./manifest";
import { assertR2ContentReadback, assertR2HeadReadback, buildRecoveryR2Keys, createR2Client } from "./r2";

const projectRoot = resolve(process.cwd());

export interface RecoveryArtifactInput {
  environment: Pick<ProductionBackupEnvironment, "ageRecipient" | "r2">;
  backupClass: RecoveryArtifactClass;
  runId: string;
  createdAt: string;
  tempRoot: string;
  stagingRoot: string;
  manifest: RecoveryManifest;
}

export interface RecoveryArtifactResult {
  artifactBytes: number;
  artifactSha256: string;
  keys: ReturnType<typeof buildRecoveryR2Keys>;
}

/** Finalize one encrypted, immutable R2 recovery artifact for backup/checkpoint callers. */
export function publishRecoveryArtifact(input: RecoveryArtifactInput): RecoveryArtifactResult {
  const { environment, backupClass, runId, createdAt, tempRoot, stagingRoot, manifest } = input;
  const manifestPath = join(stagingRoot, "manifest.json");
  writeFileSync(manifestPath, serializeManifest(manifest), { flag: "wx" });

  const encryptStart = performance.now();
  const archivePath = join(tempRoot, `${runId}.tar.gz`);
  runCommand("tar", ["-czf", archivePath, "-C", tempRoot, "backup"]);
  const artifactPath = join(tempRoot, `${runId}.tar.gz.age`);
  runCommand("age", ["-r", environment.ageRecipient, "-o", artifactPath, archivePath]);
  console.log(`timing encrypt/archive: ${Math.round(performance.now() - encryptStart)}ms`);

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

  const r2Start = performance.now();
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
  console.log(`timing R2 upload/readback: ${Math.round(performance.now() - r2Start)}ms`);

  return { artifactBytes, artifactSha256, keys };
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
    throw new Error(`${executable} recovery artifact operation failed; canonical recovery artifact aborted. `);
  }
}
