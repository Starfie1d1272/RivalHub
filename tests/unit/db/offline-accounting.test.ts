import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { recoveryConsumerSummary, reportOfflineConsumer } from "../../../scripts/db/recovery/accounting";
import type { RecoveryManifest } from "../../../scripts/db/recovery/manifest";

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

});
