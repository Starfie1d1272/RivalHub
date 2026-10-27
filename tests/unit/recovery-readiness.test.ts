import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertRecoveryReady, recordDataVerification, startRecoveryRecord } from "../../scripts/db/recovery/readiness";
import type { RecoveryManifest, RecoverySidecar } from "../../scripts/db/recovery/manifest";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("recovery readiness", () => {
  it.each(["full", "db-checkpoint"] as const)("records %s verification without authorizing traffic", (kind) => {
    const root = mkdtempSync(join(tmpdir(), "recovery-record-")); roots.push(root);
    const path = join(root, "record.jsonl");
    const manifest = { runId: "snapshot", artifactKind: kind, source: { databaseMigrationTerminal: { terminalTag: "0071" } } } as RecoveryManifest;
    const sidecar = { artifactSha256: "artifact-hash" } as RecoverySidecar;
    const run = startRecoveryRecord(path, manifest, sidecar, "postgres://user:secret@127.0.0.1:5432/fixture", "cluster:database");
    recordDataVerification(path, run);
    const raw = readFileSync(path, "utf8");
    const [start, verified] = raw.trim().split("\n").map((line) => JSON.parse(line));
    expect(start).toMatchObject({ recoveryRun: run, snapshotRun: "snapshot", artifactSha256: "artifact-hash", artifactKind: kind, reconciliationCoverage: null, providerState: "unknown" });
    expect(verified).toMatchObject({ recoveryRun: run, readiness: "blocked" });
    expect(raw).not.toContain("secret");
    expect(() => startRecoveryRecord(path, manifest, sidecar, "postgres://user:secret@127.0.0.1:5432/fixture", "cluster:database")).toThrow();
    expect(() => assertRecoveryReady()).toThrow(/not ready for traffic/);
  });
});
