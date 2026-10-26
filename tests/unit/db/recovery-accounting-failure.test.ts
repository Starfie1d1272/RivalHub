import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { publishRecoveryArtifact, type RecoveryArtifactInput } from "../../../scripts/db/recovery/artifact";
import { digestFile } from "../../../scripts/db/recovery/manifest";

const state = vi.hoisted(() => ({ spawn: vi.fn(), download: vi.fn(), objects: new Map<string, string>() }));
vi.mock("node:child_process", () => ({ spawnSync: state.spawn }));
vi.mock("../../../scripts/db/recovery/r2", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../scripts/db/recovery/r2")>(),
  createR2Client: () => ({
    put: (path: string, key: string) => { state.objects.set(key, path); },
    head: (key: string) => { const file = digestFile(state.objects.get(key)!); return { bytes: file.bytes, sha256: file.sha256 }; },
    download: (key: string, path: string) => state.download(key, path),
  }),
}));

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it.each(["full", "db-checkpoint"] as const)("keeps completed %s artifacts successful when Step Summary is unavailable", (kind) => {
  const directory = mkdtempSync(join(tmpdir(), "recovery-accounting-failure-"));
  const staging = join(directory, "backup");
  mkdirSync(staging);
  state.objects.clear();
  state.spawn.mockReset().mockImplementation((command: string, args: string[]) => {
    writeFileSync(command === "tar" ? args[1] : args[3], "synthetic-local-artifact");
    return { status: 0 };
  });
  state.download.mockReset().mockImplementation((key: string, path: string) => copyFileSync(state.objects.get(key)!, path));
  const files = ["roles.sql", "schema.sql", "data.sql"].map((name) => {
    writeFileSync(join(staging, name), "synthetic-local-dump");
    return digestFile(join(staging, name));
  });
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  const input = {
    environment: { ageRecipient: "synthetic-fixture", r2: {} }, backupClass: kind === "full" ? "manual" : "release-db",
    runId: "00000000-0000-4000-8000-000000000001", createdAt: "2026-10-26T00:00:00Z", tempRoot: directory, stagingRoot: staging,
    manifest: {
      artifactKind: kind, backupClass: kind === "full" ? "manual" : "release-db",
      runId: "00000000-0000-4000-8000-000000000001", createdAt: "2026-10-26T00:00:00Z", sourceProjectRef: "fixture",
      source: { deployedReleaseTag: "v2.24.5" }, database: { files },
      ...(kind === "full" ? { storage: { totalBytes: 0, objectCount: 0 } } : {}),
    },
  } as unknown as RecoveryArtifactInput;
  try {
    for (const summaryPath of [directory, join(directory, "PRIVATE_PATH_SENTINEL", "summary")]) {
      vi.stubEnv("GITHUB_STEP_SUMMARY", summaryPath);
      const result = publishRecoveryArtifact(input);
      expect(result.artifactBytes).toBe(Buffer.byteLength("synthetic-local-artifact"));
      expect(state.download).toHaveBeenCalledTimes(3);
      expect(state.objects.has(result.keys.completion)).toBe(true);
      expect(JSON.parse(readFileSync(state.objects.get(result.keys.completion)!, "utf8")).runId).toBe(input.runId);
      expect(state.spawn.mock.calls.map(([command]) => command)).toEqual(["tar", "age"]);
      expect(warn).toHaveBeenCalledExactlyOnceWith("offline_consumer_accounting_unavailable");
      // A real read-back failure must still propagate, outside the observation boundary.
      state.download.mockImplementationOnce(() => { throw new Error("original read-back failure"); });
      for (const path of [join(staging, "manifest.json"), join(directory, `${input.runId}.manifest.json`), join(directory, `${input.runId}.complete.json`)]) rmSync(path, { force: true });
      expect(() => publishRecoveryArtifact(input)).toThrow("original read-back failure");
      for (const path of [join(staging, "manifest.json"), join(directory, `${input.runId}.manifest.json`), join(directory, `${input.runId}.complete.json`)]) rmSync(path, { force: true });
      state.spawn.mockClear(); state.download.mockClear(); warn.mockClear();
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
