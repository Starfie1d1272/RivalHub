import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { assertBackupClass, type BackupClass } from "./environment";

export const RECOVERY_FORMAT_VERSION = 2 as const;

export interface RecoveryFileDigest {
  path: string;
  bytes: number;
  sha256: string;
}

interface RecoveryStorageSummary {
  bucketCount: number;
  bucketInventorySha256: string;
  objectCount: number;
  totalBytes: number;
  inventorySha256: string;
}

export interface RecoveryMigrationIdentity {
  terminalHash: string;
  terminalTag: string;
  terminalWhen: number;
}

interface RecoveryProducerIdentity {
  recoveryFormatVersion: typeof RECOVERY_FORMAT_VERSION;
  gitCommit: string;
  packageVersion: string;
}

export interface RecoverySourceIdentity {
  deployedReleaseTag: string;
  deployedCommit: string;
  databaseMigrationTerminal: RecoveryMigrationIdentity;
}

export interface RecoveryManifest {
  formatVersion: typeof RECOVERY_FORMAT_VERSION;
  runId: string;
  createdAt: string;
  sourceEnvironment: "production";
  sourceProjectRef: string;
  postgresVersion: string;
  supabaseCliVersion: string;
  producer: RecoveryProducerIdentity;
  source: RecoverySourceIdentity;
  backupClass: BackupClass;
  database: {
    schemas: readonly ["public", "auth"];
    files: readonly RecoveryFileDigest[];
  };
  storage: RecoveryStorageSummary;
}

export interface RecoverySidecar {
  formatVersion: typeof RECOVERY_FORMAT_VERSION;
  runId: string;
  artifactKey: string;
  artifactBytes: number;
  artifactSha256: string;
  manifestSha256: string;
  createdAt: string;
  backupClass: BackupClass;
}

export interface RecoveryCompletionMarker {
  formatVersion: typeof RECOVERY_FORMAT_VERSION;
  runId: string;
  artifactKey: string;
  artifactSha256: string;
  manifestSha256: string;
  completedAt: string;
}

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function digestFile(path: string, relativePath = basename(path)): RecoveryFileDigest {
  return {
    path: relativePath,
    bytes: statSync(path).size,
    sha256: sha256File(path),
  };
}

export function serializeManifest(manifest: RecoveryManifest): string {
  return `${stableSerialize(manifest)}\n`;
}

export function serializeSidecar(sidecar: RecoverySidecar): string {
  return `${stableSerialize(sidecar)}\n`;
}

export function serializeCompletionMarker(marker: RecoveryCompletionMarker): string {
  return `${stableSerialize(marker)}\n`;
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

export function assertRecoveryManifest(value: unknown): RecoveryManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Recovery manifest 格式无效。 ");
  }
  const manifest = value as Partial<RecoveryManifest>;
  if (
    manifest.formatVersion !== RECOVERY_FORMAT_VERSION
    || manifest.sourceEnvironment !== "production"
    || typeof manifest.runId !== "string"
    || typeof manifest.createdAt !== "string"
    || typeof manifest.sourceProjectRef !== "string"
    || typeof manifest.postgresVersion !== "string"
    || typeof manifest.supabaseCliVersion !== "string"
    || !manifest.producer
    || !manifest.source
    || !manifest.database
    || !manifest.storage
    || !manifest.backupClass
  ) {
    throw new Error("Recovery manifest 缺少必要的版本、来源或 checksum 字段。 ");
  }

  assertUuid(manifest.runId, "Recovery manifest runId");
  assertUtcTimestamp(manifest.createdAt, "Recovery manifest createdAt");
  if (!/^[a-z0-9]{20}$/.test(manifest.sourceProjectRef)) {
    throw new Error("Recovery manifest source project identity 无效。 ");
  }
  assertNonEmpty(manifest.postgresVersion, "Recovery manifest PostgreSQL version");
  assertSemver(manifest.supabaseCliVersion, "Recovery manifest Supabase CLI version");
  const producer = manifest.producer as Partial<RecoveryProducerIdentity> | undefined;
  if (
    !producer
    || producer.recoveryFormatVersion !== RECOVERY_FORMAT_VERSION
    || typeof producer.gitCommit !== "string"
    || typeof producer.packageVersion !== "string"
  ) {
    throw new Error("Recovery manifest producer identity 无效。 ");
  }
  if (!/^[0-9a-f]{40}$/i.test(producer.gitCommit)) {
    throw new Error("Recovery manifest producer commit identity 无效。 ");
  }
  assertSemver(producer.packageVersion, "Recovery manifest producer package version");

  const source = manifest.source as Partial<RecoverySourceIdentity> | undefined;
  if (
    !source
    || typeof source.deployedReleaseTag !== "string"
    || typeof source.deployedCommit !== "string"
    || !source.databaseMigrationTerminal
  ) {
    throw new Error("Recovery manifest source identity 无效。 ");
  }
  assertReleaseTag(source.deployedReleaseTag, "Recovery manifest deployed release tag");
  if (!/^[0-9a-f]{40}$/i.test(source.deployedCommit)) {
    throw new Error("Recovery manifest deployed source commit identity 无效。 ");
  }
  assertBackupClass(manifest.backupClass);

  assertMigrationIdentity(source.databaseMigrationTerminal, "Recovery manifest database migration terminal");

  const database = manifest.database as RecoveryManifest["database"] | undefined;
  if (
    !database
    || !Array.isArray(database.schemas)
    || database.schemas.length !== 2
    || database.schemas[0] !== "public"
    || database.schemas[1] !== "auth"
    || !Array.isArray(database.files)
    || database.files.length !== 3
  ) {
    throw new Error("Recovery manifest database snapshot identity 无效。 ");
  }
  const filePaths = new Set<string>();
  for (const file of database.files) {
    if (
      !file
      || typeof file.path !== "string"
      || !/^(?:roles|schema|data)\.sql$/.test(file.path)
      || filePaths.has(file.path)
      || !isNonNegativeInteger(file.bytes)
      || !isSha256(file.sha256)
    ) {
      throw new Error("Recovery manifest database file digest 无效。 ");
    }
    filePaths.add(file.path);
  }
  if (filePaths.size !== 3) throw new Error("Recovery manifest database files 不完整。 ");

  const storage = manifest.storage as RecoveryStorageSummary | undefined;
  if (
    !storage
    || !isNonNegativeInteger(storage.bucketCount)
    || !isSha256(storage.bucketInventorySha256)
    || !isNonNegativeInteger(storage.objectCount)
    || !isNonNegativeInteger(storage.totalBytes)
    || !isSha256(storage.inventorySha256)
  ) {
    throw new Error("Recovery manifest Storage snapshot summary 无效。 ");
  }
  return manifest as RecoveryManifest;
}

export function assertRecoverySidecar(value: unknown): RecoverySidecar {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Recovery sidecar manifest 格式无效。 ");
  }
  const sidecar = value as Partial<RecoverySidecar>;
  if (
    sidecar.formatVersion !== RECOVERY_FORMAT_VERSION
    || typeof sidecar.runId !== "string"
    || typeof sidecar.artifactKey !== "string"
    || typeof sidecar.artifactBytes !== "number"
    || typeof sidecar.artifactSha256 !== "string"
    || typeof sidecar.manifestSha256 !== "string"
    || typeof sidecar.createdAt !== "string"
    || !sidecar.backupClass
  ) {
    throw new Error("Recovery sidecar manifest 缺少必要的 artifact checksum 字段。 ");
  }
  assertUuid(sidecar.runId, "Recovery sidecar runId");
  assertRecoveryArtifactKey(sidecar.artifactKey);
  if (!isPositiveInteger(sidecar.artifactBytes) || !isSha256(sidecar.artifactSha256) || !isSha256(sidecar.manifestSha256)) {
    throw new Error("Recovery sidecar manifest checksum/size 无效。 ");
  }
  assertUtcTimestamp(sidecar.createdAt, "Recovery sidecar createdAt");
  assertBackupClass(sidecar.backupClass);
  return sidecar as RecoverySidecar;
}

export function assertRecoveryCompletionMarker(value: unknown): RecoveryCompletionMarker {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Recovery completion marker 格式无效。 ");
  }
  const marker = value as Partial<RecoveryCompletionMarker>;
  if (
    marker.formatVersion !== RECOVERY_FORMAT_VERSION
    || typeof marker.runId !== "string"
    || typeof marker.artifactKey !== "string"
    || typeof marker.artifactSha256 !== "string"
    || typeof marker.manifestSha256 !== "string"
    || typeof marker.completedAt !== "string"
  ) {
    throw new Error("Recovery completion marker 缺少必要字段。 ");
  }
  assertUuid(marker.runId, "Recovery completion marker runId");
  assertRecoveryArtifactKey(marker.artifactKey);
  if (!isSha256(marker.artifactSha256) || !isSha256(marker.manifestSha256)) {
    throw new Error("Recovery completion marker checksum 无效。 ");
  }
  assertUtcTimestamp(marker.completedAt, "Recovery completion marker completedAt");
  return marker as RecoveryCompletionMarker;
}

function assertRecoveryArtifactKey(value: string): string {
  if (!/^production\/(?:hourly|daily|pre-release|manual)\/\d{4}-\d{2}-\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tar\.gz\.age$/i.test(value)) {
    throw new Error("Recovery artifact key identity 无效。 ");
  }
  return value;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortKeys(entry)]),
  );
}

function assertUuid(value: string, label: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${label} 无效。 `);
  }
}

function assertUtcTimestamp(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} 必须是 UTC ISO timestamp。 `);
  }
}

function assertSemver(value: string, label: string): void {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value)) {
    throw new Error(`${label} 无效。 `);
  }
}

function assertReleaseTag(value: string, label: string): void {
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value)) {
    throw new Error(`${label} 无效。 `);
  }
}

function assertMigrationIdentity(value: unknown, label: string): asserts value is RecoveryMigrationIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} 无效。 `);
  }
  const migration = value as Partial<RecoveryMigrationIdentity>;
  if (
    !isSha256(migration.terminalHash)
    || typeof migration.terminalTag !== "string"
    || !/^\d{4}_[A-Za-z0-9_-]+$/.test(migration.terminalTag)
    || !isNonNegativeInteger(migration.terminalWhen)
  ) {
    throw new Error(`${label} 无效。 `);
  }
}

function assertNonEmpty(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} 不能为空。 `);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return isNonNegativeInteger(value) && value > 0;
}
