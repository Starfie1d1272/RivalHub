import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readExpectedMigrations } from "../../scripts/db/production-preflight";
import {
  assertProductionBackupEnvironment,
  assertRecoveryFetchEnvironment,
  assertR2EndpointForRecoveryFetch,
  assertR2BucketName,
  buildIsolatedRecoveryEnvironment,
} from "../../scripts/db/recovery/environment";
import {
  assertRecoveryCompletionMarker,
  assertRecoveryManifest,
  assertRecoverySidecar,
  sha256File,
  serializeManifest,
} from "../../scripts/db/recovery/manifest";
import { buildRecoveryMigrationPlan, resolveProductionSourceIdentity } from "../../scripts/db/recovery/source";
import {
  assertActiveStorageReferencesCaptured,
  assertActiveStorageReferencesStable,
  readStorageBuckets,
} from "../../scripts/db/recovery/storage";
import { buildRecoveryR2Keys, assertR2ContentReadback, assertR2HeadReadback, serializeR2Metadata } from "../../scripts/db/recovery/r2";
import { assertBackupHeartbeatUrl, BACKUP_HEARTBEAT_TIMEOUT_MS, sendBackupHeartbeat } from "../../scripts/db/recovery/heartbeat";
import { fetchRecoveryObjects } from "../../scripts/db/recovery/fetch";
import { assertRecoveryFormatCompatibility, RECOVERY_FORMAT_VERSION, RECOVERY_READER_FORMAT_VERSIONS } from "../../scripts/db/recovery/manifest";
import { assertSupportedStorageBucket, getStorageRecoveryPolicy, readManagedStorageReferences } from "../../scripts/db/recovery/storage-policy";
import { assertManifestMigrationMatches, verifyRecoveryDatabase } from "../../scripts/db/recovery/verify";
import { purgeExpiredEducationEvidence } from "../../src/lib/education/retention-core";
import { describe, expect, it } from "vitest";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const CREATED_AT = "2026-09-10T00:00:00.000Z";
const SHA256 = "a".repeat(64);
const GIT_COMMIT = "b".repeat(40);
const SOURCE_COMMIT = "c".repeat(40);

function validManifest() {
  const expected = readExpectedMigrations();
  const terminal = expected.at(-1);
  if (!terminal) throw new Error("migration journal is empty");
  return {
    formatVersion: 2 as const,
    runId: RUN_ID,
    createdAt: CREATED_AT,
    sourceEnvironment: "production" as const,
    sourceProjectRef: "sucokfotkypwqkckfynp",
    postgresVersion: "17.6",
    supabaseCliVersion: "2.116.0",
    producer: {
      recoveryFormatVersion: 2 as const,
      gitCommit: GIT_COMMIT,
      packageVersion: "2.7.8",
    },
    source: {
      deployedReleaseTag: "v2.7.8",
      deployedCommit: SOURCE_COMMIT,
      databaseMigrationTerminal: {
        terminalHash: terminal.hash,
        terminalTag: terminal.tag,
        terminalWhen: terminal.when,
      },
    },
    backupClass: "hourly" as const,
    database: {
      schemas: ["public", "auth"] as const,
      files: [
        { path: "roles.sql", bytes: 1, sha256: SHA256 },
        { path: "schema.sql", bytes: 2, sha256: SHA256 },
        { path: "data.sql", bytes: 3, sha256: SHA256 },
      ],
    },
    storage: {
      bucketCount: 2,
      bucketInventorySha256: SHA256,
      objectCount: 1,
      totalBytes: 3,
      inventorySha256: SHA256,
    },
  };
}

describe("recovery contracts", () => {
  it("accepts a complete manifest and serializes it deterministically", () => {
    const manifest = validManifest();
    const parsed = assertRecoveryManifest(JSON.parse(serializeManifest(manifest)));

    expect(parsed).toEqual(manifest);
    expect(serializeManifest({ ...manifest, storage: { ...manifest.storage } })).toBe(serializeManifest(manifest));
  });

  it("rejects incomplete or tampered recovery identities", () => {
    const manifest = validManifest();
    expect(() => assertRecoveryManifest({ ...manifest, database: { ...manifest.database, files: [] } })).toThrow();

    const keys = buildRecoveryR2Keys("hourly", RUN_ID, CREATED_AT);
    const sidecar = assertRecoverySidecar({
      formatVersion: 2,
      runId: RUN_ID,
      artifactKey: keys.artifact,
      artifactBytes: 10,
      artifactSha256: SHA256,
      manifestSha256: SHA256,
      createdAt: CREATED_AT,
      backupClass: "hourly",
    });
    expect(() => assertRecoveryCompletionMarker({
      formatVersion: 2,
      runId: RUN_ID,
      artifactKey: keys.artifact,
      artifactSha256: "c".repeat(64),
      manifestSha256: SHA256,
      completedAt: CREATED_AT,
    })).not.toThrow();
    expect(() => assertRecoverySidecar({ ...sidecar, artifactKey: "production/hourly/unsafe.age" })).toThrow();
  });

  it("keeps production backup read-only and rejects loopback/remote target confusion", () => {
    const environment = assertProductionBackupEnvironment({
      RIVALHUB_DB_TARGET: "production",
      RIVALHUB_PRODUCTION_PROJECT_CONFIRM: "sucokfotkypwqkckfynp",
      RIVALHUB_PRODUCTION_DB_HOST_CONFIRM: "aws-0-ap-northeast-1.pooler.supabase.com:6543",
      DATABASE_URL: "postgresql://postgres.sucokfotkypwqkckfynp:secret@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true",
      SUPABASE_SECRET_KEY: "sb_secret-modern",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
      RIVALHUB_BACKUP_AGE_RECIPIENT: "age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq",
      RIVALHUB_BACKUP_HEARTBEAT_URL: "https://uptime.betterstack.com/api/v1/heartbeat/test-token",
      RIVALHUB_R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
      RIVALHUB_R2_BUCKET: "rivalhub-recovery",
      RIVALHUB_R2_ACCESS_KEY_ID: "access-key",
      RIVALHUB_R2_SECRET_ACCESS_KEY: "secret-key",
    });

    expect(environment.databaseUrl).toBe("postgresql://postgres.sucokfotkypwqkckfynp:secret@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres");
    expect(environment.databaseUrl).not.toContain(":6543");
    expect(environment.databaseUrl).not.toContain("pgbouncer");
    expect(environment.supabaseSecretKey).toBe("sb_secret-modern");
    expect(() => assertProductionBackupEnvironment({
      RIVALHUB_DB_TARGET: "local",
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/postgres",
    })).toThrow();
    expect(() => buildIsolatedRecoveryEnvironment({
      RIVALHUB_RECOVERY_TARGET: "isolated",
      RIVALHUB_RECOVERY_DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/postgres",
      RIVALHUB_RECOVERY_SUPABASE_URL: "https://sucokfotkypwqkckfynp.supabase.co",
      RIVALHUB_RECOVERY_PUBLISHABLE_KEY: "publishable",
      RIVALHUB_RECOVERY_SERVICE_ROLE_KEY: "service-role",
    })).toThrow();
  });

  it("uses the modern Supabase secret key first and only falls back to the legacy name", () => {
    const baseEnvironment = {
      RIVALHUB_DB_TARGET: "production",
      RIVALHUB_PRODUCTION_PROJECT_CONFIRM: "sucokfotkypwqkckfynp",
      RIVALHUB_PRODUCTION_DB_HOST_CONFIRM: "aws-0-ap-northeast-1.pooler.supabase.com:6543",
      DATABASE_URL: "postgresql://postgres.sucokfotkypwqkckfynp:secret@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true",
      RIVALHUB_BACKUP_AGE_RECIPIENT: "age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq",
      RIVALHUB_BACKUP_HEARTBEAT_URL: "https://uptime.betterstack.com/api/v1/heartbeat/test-token",
      RIVALHUB_R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
      RIVALHUB_R2_BUCKET: "rivalhub-recovery",
      RIVALHUB_R2_ACCESS_KEY_ID: "access-key",
      RIVALHUB_R2_SECRET_ACCESS_KEY: "secret-key",
    };

    expect(assertProductionBackupEnvironment({
      ...baseEnvironment,
      SUPABASE_SECRET_KEY: "  sb_secret-modern  ",
      SUPABASE_SERVICE_ROLE_KEY: "legacy-service-role",
    }).supabaseSecretKey).toBe("sb_secret-modern");
    expect(assertProductionBackupEnvironment({
      ...baseEnvironment,
      SUPABASE_SERVICE_ROLE_KEY: "legacy-service-role",
    }).supabaseSecretKey).toBe("legacy-service-role");
    expect(() => assertProductionBackupEnvironment(baseEnvironment)).toThrow(
      /SUPABASE_SECRET_KEY\/SUPABASE_SERVICE_ROLE_KEY 未设置/,
    );
  });

  it("requires a Better Stack heartbeat and bounds no-start/failure notification calls", async () => {
    expect(assertBackupHeartbeatUrl("https://uptime.betterstack.com/api/v1/heartbeat/test-token")).toBe(
      "https://uptime.betterstack.com/api/v1/heartbeat/test-token",
    );
    expect(BACKUP_HEARTBEAT_TIMEOUT_MS).toBe(10_000);
    expect(() => assertBackupHeartbeatUrl("https://example.test/api/v1/heartbeat/test-token")).toThrow();
    expect(() => assertBackupHeartbeatUrl("https://uptime.betterstack.com/api/v1/heartbeat/test-token?secret=echo")).toThrow();

    const requested: string[] = [];
    const fetchImpl: typeof fetch = (async (input) => {
      requested.push(String(input));
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    await sendBackupHeartbeat("https://uptime.betterstack.com/api/v1/heartbeat/test-token", "success", fetchImpl);
    await sendBackupHeartbeat("https://uptime.betterstack.com/api/v1/heartbeat/test-token", "failure", fetchImpl);
    expect(requested).toEqual([
      "https://uptime.betterstack.com/api/v1/heartbeat/test-token",
      "https://uptime.betterstack.com/api/v1/heartbeat/test-token/fail",
    ]);
  });

  it("keeps the format-2 reader available before the format-2 writer emits artifacts", () => {
    expect(RECOVERY_READER_FORMAT_VERSIONS).toContain(RECOVERY_FORMAT_VERSION);
    expect(() => assertRecoveryFormatCompatibility()).not.toThrow();
    const manifestSource = readFileSync(join(process.cwd(), "scripts/db/recovery/manifest.ts"), "utf8");
    expect(manifestSource.indexOf("RECOVERY_FORMAT_VERSION = 2")).toBeLessThan(manifestSource.indexOf("RECOVERY_READER_FORMAT_VERSIONS"));
  });

  it("uses the storage policy registry for supported buckets and managed references", async () => {
    expect(getStorageRecoveryPolicy("team-logos")).toEqual({
      bucket: "team-logos",
      recoveryClass: "durable",
      restoreMode: "always",
    });
    expect(getStorageRecoveryPolicy("education-evidence")).toEqual({
      bucket: "education-evidence",
      recoveryClass: "temporary-sensitive",
      restoreMode: "active-reference-only",
    });
    expect(() => getStorageRecoveryPolicy("unknown-bucket")).toThrow(/no recovery policy/);
    expect(() => assertSupportedStorageBucket({ name: "team-logos" })).toThrow(/missing or unsupported/);
    expect(() => assertSupportedStorageBucket({ name: "team-logos", type: "OBJECT" })).toThrow(/missing or unsupported/);
    expect(assertSupportedStorageBucket({ name: "team-logos", type: "STANDARD" })).toEqual(getStorageRecoveryPolicy("team-logos"));

    const references = await readManagedStorageReferences({
      query: async () => ({ rows: [
        { evidence_object_key: "verification/one.png" },
        { evidence_object_key: "verification/one.png" },
      ] }),
    } as never);
    expect(references).toEqual([{ bucket: "education-evidence", objectPath: "verification/one.png" }]);
  });

  it("rejects Storage inventories without an explicit STANDARD type", () => {
    const root = mkdtempSync(join(tmpdir(), "rivalhub-storage-policy-"));
    const path = join(root, "buckets.json");
    try {
      writeFileSync(path, JSON.stringify([{ id: "logos", name: "team-logos", public: false, fileSizeLimit: null, allowedMimeTypes: null }]));
      expect(() => readStorageBuckets(path)).toThrow(/缺少字段/);
      writeFileSync(path, JSON.stringify([{ id: "logos", name: "team-logos", type: "OBJECT", public: false, fileSizeLimit: null, allowedMimeTypes: null }]));
      expect(() => readStorageBuckets(path)).toThrow(/缺少字段/);
      writeFileSync(path, JSON.stringify([{ id: "logos", name: "team-logos", type: "STANDARD", public: false, fileSizeLimit: null, allowedMimeTypes: null }]));
      expect(readStorageBuckets(path)).toEqual([{
        id: "logos",
        name: "team-logos",
        type: "STANDARD",
        public: false,
        fileSizeLimit: null,
        allowedMimeTypes: null,
      }]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts only the offline account-scoped R2 read endpoint", () => {
    const accountId = "0123456789abcdef0123456789abcdef";
    expect(assertR2EndpointForRecoveryFetch(`https://${accountId}.r2.cloudflarestorage.com`, accountId)).toBe(
      `https://${accountId}.r2.cloudflarestorage.com`,
    );
    expect(() => assertR2EndpointForRecoveryFetch("http://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com", accountId)).toThrow();
    expect(() => assertRecoveryFetchEnvironment({
      RIVALHUB_R2_ACCOUNT_ID: accountId,
      RIVALHUB_R2_BUCKET: "rivalhub-recovery",
      RIVALHUB_R2_ENDPOINT: `https://${accountId}.r2.cloudflarestorage.com`,
      RIVALHUB_R2_READ_ACCESS_KEY_ID: "read-access",
      RIVALHUB_R2_READ_SECRET_ACCESS_KEY: "read-secret",
      RIVALHUB_R2_ACCESS_KEY_ID: "writer-access",
    })).toThrow(/writer/);
    expect(() => assertRecoveryFetchEnvironment({
      RIVALHUB_R2_ACCOUNT_ID: accountId,
      RIVALHUB_R2_BUCKET: "rivalhub-recovery",
      RIVALHUB_R2_ENDPOINT: `https://${accountId}.r2.cloudflarestorage.com`,
      RIVALHUB_R2_READ_ACCESS_KEY_ID: "read-access",
      RIVALHUB_R2_READ_SECRET_ACCESS_KEY: "read-secret",
      AWS_SESSION_TOKEN: "session-token",
    })).toThrow(/writer/);
    expect(() => assertRecoveryFetchEnvironment({
      RIVALHUB_R2_ACCOUNT_ID: accountId,
      RIVALHUB_R2_BUCKET: "rivalhub-recovery",
      RIVALHUB_R2_ENDPOINT: `https://${accountId}.r2.cloudflarestorage.com`,
      RIVALHUB_R2_READ_ACCESS_KEY_ID: "read-access",
      RIVALHUB_R2_READ_SECRET_ACCESS_KEY: "read-secret",
      RIVALHUB_RECOVERY_SERVICE_ROLE_KEY: "isolated-writer",
    })).toThrow(/writer/);
    expect(assertRecoveryFetchEnvironment({
      RIVALHUB_R2_ACCOUNT_ID: accountId,
      RIVALHUB_R2_BUCKET: "rivalhub-recovery",
      RIVALHUB_R2_ENDPOINT: `https://${accountId}.r2.cloudflarestorage.com`,
      RIVALHUB_R2_READ_ACCESS_KEY_ID: "read-access",
      RIVALHUB_R2_READ_SECRET_ACCESS_KEY: "read-secret",
    }).endpoint).toBe(`https://${accountId}.r2.cloudflarestorage.com`);
  });

  it("fetches completion then sidecar then encrypted artifact into a new restricted directory", async () => {
    const root = mkdtempSync(join(tmpdir(), "rivalhub-fetch-contract-"));
    const completionKey = `production/hourly/2026-09-10/${RUN_ID}.complete.json`;
    const artifactKey = `production/hourly/2026-09-10/${RUN_ID}.tar.gz.age`;
    const manifestKey = `production/hourly/2026-09-10/${RUN_ID}.manifest.json`;
    const artifact = Buffer.from("encrypted artifact bytes");
    const artifactSha256 = sha256Bytes(artifact);
    const sidecarValue = {
      formatVersion: 2,
      runId: RUN_ID,
      artifactKey,
      artifactBytes: artifact.byteLength,
      artifactSha256,
      manifestSha256: "d".repeat(64),
      createdAt: CREATED_AT,
      backupClass: "hourly",
    } as const;
    const completionValue = {
      formatVersion: 2,
      runId: RUN_ID,
      artifactKey,
      artifactSha256,
      manifestSha256: sidecarValue.manifestSha256,
      completedAt: CREATED_AT,
    } as const;
    const objects = new Map<string, Buffer>([
      [completionKey, Buffer.from(`${JSON.stringify(completionValue)}\n`)],
      [manifestKey, Buffer.from(`${JSON.stringify(sidecarValue)}\n`)],
      [artifactKey, artifact],
    ]);
    const order: string[] = [];
    const client = {
      endpoint: "https://r2.example.invalid",
      bucket: "rivalhub-recovery",
      head: (key: string) => {
        const bytes = objects.get(key);
        if (!bytes) throw new Error("missing object");
        return { bytes: bytes.byteLength, sha256: sha256Bytes(bytes) };
      },
      download: (key: string, path: string) => {
        const bytes = objects.get(key);
        if (!bytes) throw new Error("missing object");
        order.push(key);
        writeFileSync(path, bytes, { flag: "wx" });
      },
    };

    try {
      const output = await fetchRecoveryObjects(
        {
          accountId: "0123456789abcdef0123456789abcdef",
          bucket: "rivalhub-recovery",
          endpoint: "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
          accessKeyId: "read-access",
          secretAccessKey: "read-secret",
        },
        completionKey,
        join(root, "verified-run"),
        client,
      );
      expect(order).toEqual([completionKey, manifestKey, artifactKey]);
      expect(statSync(output).mode & 0o777).toBe(0o700);
      expect(readFileSync(join(output, "artifact.tar.gz.age"))).toEqual(artifact);
      expect(readFileSync(join(output, "sidecar.json"), "utf8")).toContain(RUN_ID);
      expect(readFileSync(join(output, "completion.json"), "utf8")).toContain(RUN_ID);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("enforces session pooler :5432 for production backup and rejects :6543 transaction mode", () => {
    const baseEnvironment = {
      RIVALHUB_DB_TARGET: "production",
      RIVALHUB_PRODUCTION_PROJECT_CONFIRM: "sucokfotkypwqkckfynp",
      RIVALHUB_PRODUCTION_DB_HOST_CONFIRM: "aws-0-ap-northeast-1.pooler.supabase.com:6543",
      DATABASE_URL: "postgresql://postgres.sucokfotkypwqkckfynp:secret@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true",
      SUPABASE_SECRET_KEY: "sb_secret-modern",
      RIVALHUB_BACKUP_AGE_RECIPIENT: "age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq",
      RIVALHUB_BACKUP_HEARTBEAT_URL: "https://uptime.betterstack.com/api/v1/heartbeat/test-token",
      RIVALHUB_R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
      RIVALHUB_R2_BUCKET: "rivalhub-recovery",
      RIVALHUB_R2_ACCESS_KEY_ID: "access-key",
      RIVALHUB_R2_SECRET_ACCESS_KEY: "secret-key",
    };

    const derived = assertProductionBackupEnvironment(baseEnvironment);
    expect(derived.databaseUrl).toBe(
      "postgresql://postgres.sucokfotkypwqkckfynp:secret@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres",
    );
    expect(derived.databaseUrl).not.toContain("6543");
    expect(derived.databaseUrl).not.toContain("pgbouncer");

    // Rejects an explicit backup URL targeting the 6543 transaction pooler or setting pgbouncer=true
    expect(() => assertProductionBackupEnvironment({
      ...baseEnvironment,
      RIVALHUB_PRODUCTION_BACKUP_DATABASE_URL: "postgresql://postgres.sucokfotkypwqkckfynp:secret@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true",
    })).toThrow(/Transaction Pooler/);

    expect(() => assertProductionBackupEnvironment({
      ...baseEnvironment,
      RIVALHUB_PRODUCTION_BACKUP_DATABASE_URL: "postgresql://postgres.sucokfotkypwqkckfynp:secret@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres?pgbouncer=true",
    })).toThrow(/Session Pooler/);

    // Static code contract proving backup.ts passes the verified session pooler URL to dump
    const backupSource = readFileSync(join(process.cwd(), "scripts/db/recovery/backup.ts"), "utf8");
    expect(backupSource).toContain("assertProductionBackupEnvironment(process.env)");
    expect(backupSource).toContain("createDatabaseSnapshot(environment.databaseUrl, stagingRoot)");
    expect(backupSource).not.toMatch(/databaseUrl.*6543/);
  });

  it("fails closed when managed Storage references drift during the backup window", () => {
    const before = [
      { bucket: "education-evidence", objectPath: "verification/first.png" },
      { bucket: "education-evidence", objectPath: "verification/second.png" },
    ];

    expect(() => assertActiveStorageReferencesStable(before, [...before].reverse())).not.toThrow();
    expect(() => assertActiveStorageReferencesStable(
      before,
      [...before, { bucket: "education-evidence", objectPath: "verification/new.png" }],
    )).toThrow(/changed during the backup window/);
    expect(() => assertActiveStorageReferencesStable(
      before,
      [before[0]!],
    )).toThrow(/changed during the backup window/);
  });

  it("checks managed Storage references around the complete snapshot window", () => {
    const backupSource = readFileSync(join(process.cwd(), "scripts/db/recovery/backup.ts"), "utf8");
    const firstReferenceRead = backupSource.indexOf("readManagedStorageReferencesFromProduction(environment.databaseUrl)");
    const databaseSnapshot = backupSource.indexOf("createDatabaseSnapshot(environment.databaseUrl, stagingRoot)");
    const storageSnapshot = backupSource.indexOf("snapshotStorage(");
    const secondReferenceRead = backupSource.indexOf("readManagedStorageReferencesFromProduction(environment.databaseUrl)", firstReferenceRead + 1);
    const stabilityCheck = backupSource.indexOf("assertActiveStorageReferencesStable(");
    const captureCheck = backupSource.indexOf("assertActiveStorageReferencesCaptured(");

    expect(firstReferenceRead).toBeGreaterThan(-1);
    expect(firstReferenceRead).toBeLessThan(databaseSnapshot);
    expect(databaseSnapshot).toBeLessThan(storageSnapshot);
    expect(storageSnapshot).toBeLessThan(secondReferenceRead);
    expect(secondReferenceRead).toBeLessThan(stabilityCheck);
    expect(stabilityCheck).toBeLessThan(captureCheck);

    const completionReadback = backupSource.indexOf("verifyR2Object(r2, keys.completion");
    const successHeartbeat = backupSource.indexOf('sendBackupHeartbeat(environment.backupHeartbeatUrl, "success")');
    const failureHeartbeat = backupSource.indexOf('sendBackupHeartbeat(environment.backupHeartbeatUrl, "failure")');
    expect(completionReadback).toBeGreaterThan(-1);
    expect(completionReadback).toBeLessThan(successHeartbeat);
    expect(successHeartbeat).toBeLessThan(failureHeartbeat);
    expect(backupSource).toContain("Better Stack failure heartbeat could not be delivered.");
    expect(backupSource).not.toContain("education_verifications");
    expect(backupSource).toContain("readManagedStorageReferences(pool)");
  });

  it("keeps R2 bucket names within the provider length contract", () => {
    expect(() => assertR2BucketName("a".repeat(63))).not.toThrow();
    expect(() => assertR2BucketName("a".repeat(64))).toThrow();
  });

  it("requires the exact active migration prefix and terminal identity", () => {
    const expected = readExpectedMigrations();
    const actual = expected.map(({ hash, when }) => ({ hash, when }));
    const terminal = expected.at(-1);
    if (!terminal) throw new Error("migration journal is empty");
    const manifest = validManifest().source.databaseMigrationTerminal;

    expect(() => assertManifestMigrationMatches(actual, expected, manifest)).not.toThrow();
    expect(() => assertManifestMigrationMatches(
      actual.slice(0, -1),
      expected,
      { ...manifest, terminalHash: terminal.hash },
    )).toThrow();
  });

  it("separates producer N from a production snapshot terminal at N-1", () => {
    const expected = readExpectedMigrations();
    const previous = expected.at(-2);
    if (!previous) throw new Error("migration journal must contain a previous terminal");
    const manifest = validManifest();
    manifest.source.databaseMigrationTerminal = {
      terminalHash: previous.hash,
      terminalTag: previous.tag,
      terminalWhen: previous.when,
    };

    const replayPlan = buildRecoveryMigrationPlan(expected, manifest.source.databaseMigrationTerminal);

    expect(manifest.producer.packageVersion).toBe("2.7.8");
    expect(manifest.producer.gitCommit).toBe(GIT_COMMIT);
    expect(manifest.source.deployedReleaseTag).toBe("v2.7.8");
    expect(manifest.source.deployedCommit).toBe(SOURCE_COMMIT);
    expect(replayPlan).toHaveLength(expected.length - 1);
    expect(replayPlan.at(-1)).toEqual(previous);
  });

  it("reads production source identity from the canonical endpoint and proves it locally", async () => {
    const fixture = createReleaseGitFixture();
    let requestedUrl = "";
    let requestedInit: RequestInit | undefined;

    try {
      const source = await resolveProductionSourceIdentity(
        fixture.directory,
        {
          RELEASE_TAG: "v9.9.9",
          RIVALHUB_PRODUCTION_STABLE_REF: "origin/main",
          RIVALHUB_PRODUCTION_BASE_URL: "https://production.example.test/",
        },
        async (input, init) => {
          requestedUrl = String(input);
          requestedInit = init;
          return new Response(JSON.stringify({ releaseTag: fixture.tag, releaseCommit: fixture.commit }), { status: 200 });
        },
      );

      expect(source).toEqual({ deployedReleaseTag: fixture.tag, deployedCommit: fixture.commit });
      expect(requestedUrl).toBe("https://production.example.test/api/system/release");
      expect(requestedInit).toMatchObject({ method: "GET", cache: "no-store", redirect: "error" });
    } finally {
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  });

  it("fails closed when production source endpoint read-back is malformed or unreachable", async () => {
    await expect(resolveProductionSourceIdentity(
      process.cwd(),
      { RIVALHUB_PRODUCTION_BASE_URL: "https://production.example.test" },
      async () => new Response(JSON.stringify({ releaseTag: "v2.7.8", releaseCommit: "a".repeat(40), extra: true }), { status: 200 }),
    )).rejects.toThrow(/只能包含/);

    await expect(resolveProductionSourceIdentity(
      process.cwd(),
      { RIVALHUB_PRODUCTION_BASE_URL: "https://production.example.test" },
      async () => new Response("unavailable", { status: 503 }),
    )).rejects.toThrow(/HTTP 503/);

    await expect(resolveProductionSourceIdentity(
      process.cwd(),
      { RIVALHUB_PRODUCTION_BASE_URL: "https://production.example.test" },
      async () => { throw new Error("network down"); },
    )).rejects.toThrow(/network down/);
  });

  it("fails closed when the endpoint tag does not resolve to its returned commit", async () => {
    const fixture = createReleaseGitFixture();
    try {
      await expect(resolveProductionSourceIdentity(
        fixture.directory,
        { RIVALHUB_PRODUCTION_BASE_URL: "https://production.example.test" },
        async () => new Response(JSON.stringify({
          releaseTag: fixture.tag,
          releaseCommit: "a".repeat(40),
        }), { status: 200 }),
      )).rejects.toThrow(/tag 与 commit 不匹配/);
    } finally {
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  });

  it("rejects an unsafe or empty production base URL", async () => {
    await expect(resolveProductionSourceIdentity(
      process.cwd(),
      { RIVALHUB_PRODUCTION_BASE_URL: "http://production.example.test" },
      async () => new Response("should not be requested", { status: 200 }),
    )).rejects.toThrow(/HTTPS origin/);

    await expect(resolveProductionSourceIdentity(
      process.cwd(),
      { RIVALHUB_PRODUCTION_BASE_URL: "" },
      async () => new Response("should not be requested", { status: 200 }),
    )).rejects.toThrow(/不能是空值/);

    await expect(resolveProductionSourceIdentity(
      process.cwd(),
      { RIVALHUB_PRODUCTION_BASE_URL: "https://production.example.test:8443" },
      async () => new Response("should not be requested", { status: 200 }),
    )).rejects.toThrow(/HTTPS origin/);
  });

  it("fails closed on representative broken domain and auth invariants", async () => {
    const healthy = new RecoveryQueryStub();
    await expect(verifyRecoveryDatabase(healthy as never)).resolves.toMatchObject({ foreignKeyCount: 0 });

    const brokenIdentity = new RecoveryQueryStub("public.user_identities i");
    await expect(verifyRecoveryDatabase(brokenIdentity as never)).rejects.toThrow(/identity\.user_identities_dangling/);

    const brokenAuth = new RecoveryQueryStub("auth.users au");
    await expect(verifyRecoveryDatabase(brokenAuth as never)).rejects.toThrow(/auth\.active_users_auth_id_mapping/);
  });

  it("shares the seven-day retention algorithm with the application adapter", async () => {
    const actions: string[] = [];
    const now = new Date("2026-09-10T00:00:00.000Z");
    const reviewedBefore = new Date("2026-09-03T00:00:00.000Z");
    const cleared = await purgeExpiredEducationEvidence({
      findExpiredManualEvidence: async (before) => {
        expect(before).toEqual(reviewedBefore);
        return [{ id: "manual-1", evidenceObjectKey: "manual-1/file.png" }];
      },
      removeEvidenceObject: async (key) => { actions.push(`remove:${key}`); },
      clearManualEvidence: async (id, key) => {
        actions.push(`clear:${id}:${key}`);
        return 1;
      },
      clearExpiredChsiCodes: async (before) => {
        expect(before).toEqual(reviewedBefore);
        actions.push("clear-codes");
        return 1;
      },
    }, now);

    expect(cleared).toBe(2);
    expect(actions).toEqual([
      "remove:manual-1/file.png",
      "clear:manual-1:manual-1/file.png",
      "clear-codes",
    ]);
  });

  it("requires R2 read-back size and checksum to match", () => {
    expect(() => assertR2HeadReadback({ bytes: 10, sha256: SHA256 }, { bytes: 10, sha256: SHA256 })).not.toThrow();
    expect(() => assertR2HeadReadback({ bytes: 9, sha256: SHA256 }, { bytes: 10, sha256: SHA256 })).toThrow();
  });

  it("verifies R2 object content after GET, not only metadata", () => {
    const root = mkdtempSync(join(tmpdir(), "rivalhub-r2-contract-"));
    const path = join(root, "readback.bin");
    try {
      writeFileSync(path, "trusted content");
      const expected = { bytes: 15, sha256: sha256File(path) };
      expect(() => assertR2ContentReadback(path, expected)).not.toThrow();
      writeFileSync(path, "tampered content");
      expect(() => assertR2ContentReadback(path, expected)).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("requires active Storage object references to be present in the inventory", () => {
    const records = [{ bucket: "education-evidence", objectPath: "verification/object.png", archivePath: "objects/00000001.bin", bytes: 1, contentType: "image/png", sha256: SHA256 }];
    expect(() => assertActiveStorageReferencesCaptured(
      [{ bucket: "education-evidence", objectPath: "verification/object.png" }],
      records,
    )).not.toThrow();
    expect(() => assertActiveStorageReferencesCaptured(
      [{ bucket: "education-evidence", objectPath: "verification/missing.png" }],
      records,
    )).toThrow();
  });

  it("serializes AWS metadata as one map argument", () => {
    expect(serializeR2Metadata({ sha256: SHA256, "run-id": RUN_ID })).toBe(`sha256=${SHA256},run-id=${RUN_ID}`);
  });
});

function createReleaseGitFixture(): { directory: string; tag: string; commit: string } {
  const directory = mkdtempSync(join(tmpdir(), "rivalhub-release-source-"));
  const git = (args: readonly string[]) => execFileSync("git", args, { cwd: directory, stdio: "ignore" });
  git(["init", "--quiet"]);
  git(["config", "user.email", "rivalhub-test@example.invalid"]);
  git(["config", "user.name", "RivalHub Test"]);
  writeFileSync(join(directory, "fixture.txt"), "release source fixture\n");
  git(["add", "fixture.txt"]);
  git(["commit", "--quiet", "-m", "release source fixture"]);
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: directory, encoding: "utf8" }).trim();
  const tag = "v1.0.0";
  git(["tag", tag]);
  return { directory, tag, commit };
}

function sha256Bytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

class RecoveryQueryStub {
  constructor(private readonly failingNeedle?: string) {}

  async query<T>(queryText: string): Promise<{ rows: T[] }> {
    const expected = readExpectedMigrations();
    if (queryText.includes("drizzle.__drizzle_migrations")) {
      return { rows: expected.map(({ hash, when }) => ({ hash, when: String(when) })) as T[] };
    }
    if (queryText.includes("information_schema.tables")) {
      return {
        rows: [
          "users",
          "user_identities",
          "seasons",
          "competition_entries",
          "competition_entry_participants",
          "competition_entry_roster_revisions",
          "event_rosters",
          "matches",
          "match_maps",
          "match_player_stats",
          "audit_logs",
        ].map((table_name) => ({ table_name })) as T[],
      };
    }
    if (queryText.includes("json_agg(") && queryText.includes("WHERE c.contype = 'f'")) return { rows: [] };
    if (queryText.includes("FROM pg_constraint c")) return { rows: [{ count: "0" }] as T[] };
    if (queryText.includes("SELECT count(*)::text AS count")) {
      return { rows: [{ count: this.failingNeedle && queryText.includes(this.failingNeedle) ? "1" : "0" }] as T[] };
    }
    throw new Error(`unexpected recovery query: ${queryText}`);
  }
}
