import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { recoveryConsumerSummary, reportOfflineConsumer } from "../../../scripts/db/recovery/accounting";
import type { RecoveryManifest } from "../../../scripts/db/recovery/manifest";

const state = vi.hoisted(() => ({ query: vi.fn() }));
const names = vi.hoisted(() => ["education_verifications", "event_roster_members", "community_groups", "seasons", "users", "competition_entries", "competition_entry_participants", "teams"]);
vi.mock("pg", () => ({ Pool: class {
  connect = async () => ({ query: state.query, release: vi.fn() });
  end = vi.fn();
} }));
vi.mock("../../../scripts/db/preview/environment", () => ({ sourceDatabaseUrl: () => "postgresql://localhost/fixture" }));
vi.mock("../../../scripts/db/recovery/source", () => ({ resolveProductionSourceIdentity: async () => ({ deployedCommit: "a".repeat(40), deployedReleaseTag: "v2.24.5" }) }));
vi.mock("../../../scripts/db/production-preflight", () => ({ assertActiveChainPrefix: vi.fn(), readExpectedMigrations: () => [] }));
vi.mock("../../../scripts/db/preview/policy", () => ({
  previewPolicyFor: () => ({ tables: Object.fromEntries(names.map((name) => [name, {}])) }),
  assertReviewedColumns: vi.fn(),
}));

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("offline consumer accounting", () => {
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
    vi.stubEnv("RIVALHUB_PREVIEW_PUBLIC_ASSET_ALLOWLIST", "public/a.png,public/b.png");
    state.query.mockReset().mockImplementation(async (sql: string) => ({ rows:
      sql.includes("FROM drizzle.") ? [{ hash: "fixture", when: "1" }]
        : sql.includes("pg_catalog.pg_class") ? names.map((table_name) => ({ table_name, column_name: "id" })) : [],
    }));
    const bytes = Buffer.from("synthetic-image-buffer");
    const download = vi.fn(async (url: URL, init: RequestInit) => {
      expect(url.pathname).toMatch(/^\/storage\/v1\/object\/public\/season-public-assets\/public\/[ab]\.png$/);
      expect(init.headers).toBeUndefined();
      return new Response(new Uint8Array(bytes), { headers: { "content-type": "image/png" } });
    });
    vi.stubGlobal("fetch", download);
    const { exportMirror } = await import("../../../scripts/db/preview/snapshot");
    const accounting = { tables: {}, storage_download_bytes: null as number | null };
    const snapshot = await exportMirror(accounting);
    expect(download).toHaveBeenCalledTimes(2);
    expect(accounting.storage_download_bytes).toBe(bytes.length * 2);
    expect(snapshot.assets).toHaveLength(2);
    vi.stubEnv("RIVALHUB_PREVIEW_PUBLIC_ASSET_ALLOWLIST", "");
    download.mockClear();
    await exportMirror(accounting);
    expect(download).not.toHaveBeenCalled();
    expect(accounting.storage_download_bytes).toBe(0);
  });
});
