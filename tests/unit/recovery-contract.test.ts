import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readExpectedMigrations } from "../../scripts/db/production-preflight";
import { assertProductionBackupEnvironment, buildIsolatedRecoveryEnvironment, isProductionRecoverySource } from "../../scripts/db/recovery/environment";
import { assertRecoveryCompletionMarker, assertRecoveryManifest, assertRecoverySidecar, sha256File, RECOVERY_FORMAT_VERSION } from "../../scripts/db/recovery/manifest";
import { assertActiveStorageReferencesCaptured, assertActiveStorageReferencesStable } from "../../scripts/db/recovery/storage";
import { buildRecoveryR2Keys, assertR2ContentReadback } from "../../scripts/db/recovery/r2";
import { assertManifestMigrationMatches, verifyRecoveryDatabase } from "../../scripts/db/recovery/verify";
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
    formatVersion: RECOVERY_FORMAT_VERSION,
    runId: RUN_ID,
    createdAt: CREATED_AT,
    sourceEnvironment: "production" as const,
    sourceProjectRef: "ggkxqgbiudlovcgizgsq",
    postgresVersion: "17.6",
    supabaseCliVersion: "2.116.0",
    producer: {
      recoveryFormatVersion: RECOVERY_FORMAT_VERSION,
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
    artifactKind: "full" as const,
    backupClass: "daily" as const,
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
  it("accepts the previous production backup source without allowing arbitrary projects", () => {
    expect(isProductionRecoverySource("eurxkguokrkvpcsmxuru")).toBe(true);
    expect(isProductionRecoverySource("atjiukerfgqlwvnctigc")).toBe(true);
    expect(isProductionRecoverySource("abcdefghijklmnopqrst")).toBe(false);
  });

  it("rejects incomplete or tampered recovery identities", () => {
    const manifest = validManifest();
    expect(() => assertRecoveryManifest({ ...manifest, database: { ...manifest.database, files: [] } })).toThrow();

    const keys = buildRecoveryR2Keys("daily", RUN_ID, CREATED_AT);
    const sidecar = assertRecoverySidecar({
      formatVersion: 2,
      runId: RUN_ID,
      artifactKey: keys.artifact,
      artifactBytes: 10,
      artifactSha256: SHA256,
      manifestSha256: SHA256,
      createdAt: CREATED_AT,
      backupClass: "daily",
    });
    expect(() => assertRecoveryCompletionMarker({
      formatVersion: 2,
      runId: RUN_ID,
      artifactKey: keys.artifact,
      artifactSha256: "c".repeat(64),
      manifestSha256: SHA256,
      completedAt: CREATED_AT,
    })).not.toThrow();
    expect(() => assertRecoverySidecar({ ...sidecar, artifactKey: "production/daily/unsafe.age" })).toThrow();
  });

  it("keeps production backup read-only and rejects loopback/remote target confusion", () => {
    const environment = assertProductionBackupEnvironment({
      RIVALHUB_DB_TARGET: "production",
      RIVALHUB_PRODUCTION_PROJECT_CONFIRM: "ggkxqgbiudlovcgizgsq",
      RIVALHUB_PRODUCTION_DB_HOST_CONFIRM: "aws-0-ap-northeast-1.pooler.supabase.com:6543",
      DATABASE_URL: "postgresql://postgres.ggkxqgbiudlovcgizgsq:secret@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true",
      SUPABASE_SECRET_KEY: "sb_secret_modern",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
      RIVALHUB_BACKUP_AGE_RECIPIENT: "age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq",
      RIVALHUB_R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
      RIVALHUB_R2_BUCKET: "rivalhub-recovery",
      RIVALHUB_R2_ACCESS_KEY_ID: "access-key",
      RIVALHUB_R2_SECRET_ACCESS_KEY: "secret-key",
    });

    expect(environment.databaseUrl).toBe("postgresql://postgres.ggkxqgbiudlovcgizgsq:secret@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres");
    expect(environment.databaseUrl).not.toContain(":6543");
    expect(environment.databaseUrl).not.toContain("pgbouncer");
    expect(environment.supabaseSecretKey).toBe("sb_secret_modern");
    expect(() => assertProductionBackupEnvironment({
      RIVALHUB_DB_TARGET: "local",
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/postgres",
    })).toThrow();
    expect(() => buildIsolatedRecoveryEnvironment({
      RIVALHUB_RECOVERY_TARGET: "isolated",
      RIVALHUB_RECOVERY_DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/postgres",
      RIVALHUB_RECOVERY_SUPABASE_URL: "https://ggkxqgbiudlovcgizgsq.supabase.co",
      RIVALHUB_RECOVERY_PUBLISHABLE_KEY: "publishable",
      RIVALHUB_RECOVERY_SERVICE_ROLE_KEY: "service-role",
    })).toThrow();
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

  it("fails closed on representative broken domain and auth invariants", async () => {
    const healthy = new RecoveryQueryStub();
    await expect(verifyRecoveryDatabase(healthy as never)).resolves.toMatchObject({ foreignKeyCount: 0 });

    const brokenMerged = new RecoveryQueryStub("public.users merged");
    await expect(verifyRecoveryDatabase(brokenMerged as never)).rejects.toThrow(/identity.merged_target_invalid/);

    const brokenAuth = new RecoveryQueryStub("auth.users au");
    await expect(verifyRecoveryDatabase(brokenAuth as never)).rejects.toThrow(/auth.active_users_auth_id_mapping/);
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

});

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
          "event_rosters",
          "matches",
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
