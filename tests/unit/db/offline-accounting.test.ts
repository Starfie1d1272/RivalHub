import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { measureExportRows, recoveryConsumerSummary, reportOfflineConsumer } from "../../../scripts/db/recovery/accounting";
import type { RecoveryManifest } from "../../../scripts/db/recovery/manifest";

const state = vi.hoisted(() => ({ query: vi.fn(), download: vi.fn() }));
const names = vi.hoisted(() => ["education_verifications", "event_roster_members", "community_groups", "seasons", "users", "competition_entries", "competition_entry_participants", "teams"]);
vi.mock("pg", () => ({ Pool: class {
  connect = async () => ({ query: state.query, release: vi.fn() });
  end = vi.fn();
} }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ storage: { from: () => ({ download: state.download }) } }) }));
vi.mock("../../../scripts/db/preview/environment", () => ({ sourceDatabaseUrl: () => "postgresql://localhost/fixture" }));
vi.mock("../../../scripts/db/recovery/source", () => ({ resolveProductionSourceIdentity: async () => ({ deployedCommit: "a".repeat(40), deployedReleaseTag: "v2.24.5" }) }));
vi.mock("../../../scripts/db/production-preflight", () => ({ assertActiveChainPrefix: vi.fn(), readExpectedMigrations: () => [] }));
vi.mock("../../../scripts/db/preview/policy", () => ({
  previewPolicyFor: () => ({ tables: Object.fromEntries(names.map((name) => [name, {}])) }),
  assertReviewedColumns: vi.fn(), exportQuery: (table: string) => `SELECT fixture FROM ${table}`,
}));

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("offline consumer accounting", () => {
  it("counts UTF-8 row JSON in the existing export, with one SELECT per table", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    const payload = { id: "fixture", text: '中文\n"\\', nested: { value: "x".repeat(100_000) } };
    state.query.mockReset().mockImplementation(async (sql: string) => ({ rows:
      sql.includes("FROM drizzle.") ? [{ hash: "fixture", when: "1" }]
        : sql.includes("information_schema") ? names.map((table_name) => ({ table_name, column_name: "id" }))
          : sql === "SELECT fixture FROM users" ? [payload] : [],
    }));
    const { exportMirror, writeMirrorSnapshot } = await import("../../../scripts/db/preview/snapshot");
    const accounting = { tables: {} as Record<string, ReturnType<typeof measureExportRows>>, storage_download_bytes: null };
    const snapshot = await exportMirror(accounting);
    expect(accounting.tables.users).toEqual({ rows: 1, logical_payload_bytes: Buffer.byteLength(JSON.stringify(payload)) });
    expect(accounting.storage_download_bytes).toBeNull();
    expect(state.query.mock.calls.filter(([sql]) => String(sql).startsWith("SELECT fixture"))).toHaveLength(names.length);
    for (const name of names) expect(state.query.mock.calls.filter(([sql]) => sql === `SELECT fixture FROM ${name}`)).toHaveLength(1);
    const directory = mkdtempSync(join(tmpdir(), "offline-accounting-"));
    try {
      const path = join(directory, "mirror.json");
      writeMirrorSnapshot(path, snapshot);
      const bytes = readFileSync(path);
      expect(statSync(path).size).toBe(Buffer.byteLength(JSON.stringify(snapshot)));
      expect(gzipSync(bytes).length).toBeLessThan(bytes.length);
      expect(bytes.length).toBeGreaterThan(accounting.tables.users.logical_payload_bytes);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.spyOn(console, "log").mockImplementation(() => {});
      for (const summaryPath of [directory, join(directory, "PRIVATE_PATH_SENTINEL", "summary")]) {
        vi.stubEnv("GITHUB_STEP_SUMMARY", summaryPath);
        expect(() => reportOfflineConsumer({
          format: 1, consumer: "preview", run_id: null, github_run_id: null,
          release: snapshot.sourceTag, source_project: "fixture", started_at: snapshot.refreshedAt, ended_at: snapshot.refreshedAt,
          status: "exported", rows: 1, logical_payload_bytes: accounting.tables.users.logical_payload_bytes,
          dump_file_bytes: null, snapshot_file_bytes: bytes.length, compressed_artifact_bytes: null,
          storage_download_bytes: null, storage_objects: null, tables: accounting.tables,
        })).not.toThrow();
        expect(readFileSync(path)).toEqual(bytes);
        expect(warn).toHaveBeenCalledExactlyOnceWith("offline_consumer_accounting_unavailable");
        expect(state.query.mock.calls.filter(([sql]) => String(sql).startsWith("SELECT fixture"))).toHaveLength(names.length);
        warn.mockClear();
      }
      // The observation catch never wraps the authoritative snapshot write.
      expect(() => writeMirrorSnapshot(path, snapshot)).toThrow("Preview mirror snapshot write failed.");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("projects only existing file/storage numbers and never manifest secrets or hashes", () => {
    const manifest = {
      artifactKind: "full", runId: "fixture-run", createdAt: "2026-10-26T00:00:00Z", sourceProjectRef: "fixture-project",
      source: { deployedReleaseTag: "v2.24.5", deployedCommit: "private-commit" },
      database: { files: [{ bytes: 10, sha256: "AUTH_HASH_SENTINEL" }, { bytes: 20 }, { bytes: 30 }] },
      storage: { totalBytes: 80, objectCount: 2, inventorySha256: "PRIVATE_KEY_SENTINEL" },
    } as unknown as RecoveryManifest;
    const summary = recoveryConsumerSummary(manifest, 17, "2026-10-26T00:01:00Z");
    expect(summary).toMatchObject({ dump_file_bytes: 60, compressed_artifact_bytes: 17, storage_download_bytes: 80, rows: null, logical_payload_bytes: null });
    const checkpoint = recoveryConsumerSummary({ ...manifest, artifactKind: "db-checkpoint", backupClass: "release-db" } as RecoveryManifest, 9, summary.ended_at);
    expect(checkpoint.storage_download_bytes).toBeNull();
    const directory = mkdtempSync(join(tmpdir(), "offline-summary-"));
    try {
      const path = join(directory, "summary");
      writeFileSync(path, "");
      vi.stubEnv("GITHUB_STEP_SUMMARY", path);
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      reportOfflineConsumer(summary);
      expect(log).toHaveBeenCalledWith(`offline_consumer_summary ${JSON.stringify(summary)}`);
      const output = readFileSync(path, "utf8");
      expect(output).toContain('"dump_file_bytes":60');
      expect(output).not.toMatch(/SENTINEL|private-commit|sha256/);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("counts existing Storage download buffers once and distinguishes an observed empty export", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "synthetic-fixture-only");
    vi.stubEnv("RIVALHUB_PREVIEW_PUBLIC_ASSET_ALLOWLIST", "public/a.png,public/b.png");
    state.query.mockReset().mockImplementation(async (sql: string) => ({ rows:
      sql.includes("FROM drizzle.") ? [{ hash: "fixture", when: "1" }]
        : sql.includes("information_schema") ? names.map((table_name) => ({ table_name, column_name: "id" })) : [],
    }));
    const bytes = Buffer.from("synthetic-image-buffer");
    state.download.mockReset().mockImplementation(async () => ({ error: null, data: new Blob([bytes], { type: "image/png" }) }));
    const { exportMirror } = await import("../../../scripts/db/preview/snapshot");
    const accounting = { tables: {}, storage_download_bytes: null as number | null };
    const snapshot = await exportMirror(accounting);
    expect(state.download).toHaveBeenCalledTimes(2);
    expect(accounting.storage_download_bytes).toBe(bytes.length * 2);
    expect(snapshot.assets).toHaveLength(2);
    vi.stubEnv("RIVALHUB_PREVIEW_PUBLIC_ASSET_ALLOWLIST", "");
    state.download.mockClear();
    await exportMirror(accounting);
    expect(state.download).not.toHaveBeenCalled();
    expect(accounting.storage_download_bytes).toBe(0);
  });
});
