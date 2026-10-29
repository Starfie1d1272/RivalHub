import { appendFileSync } from "node:fs";
import type { RecoveryManifest } from "./manifest";

export interface OfflineConsumerSummary {
  format: 1;
  consumer: "recovery-full" | "recovery-db-checkpoint" | "preview";
  run_id: string | null;
  github_run_id: string | null;
  release: string | null;
  source_project: string;
  started_at: string;
  ended_at: string;
  status: "exported" | "skipped";
  rows: number | null;
  logical_payload_bytes: number | null;
  dump_file_bytes: number | null;
  snapshot_file_bytes: number | null;
  compressed_artifact_bytes: number | null;
  storage_download_bytes: number | null;
  storage_objects: number | null;
  tables: Record<string, { rows: number; logical_payload_bytes: number }> | null;
}

/** Count decoded, projected row JSON; never retain rows or emit their contents. */
export function measureExportRows(rows: readonly Record<string, unknown>[]): { rows: number; logical_payload_bytes: number } {
  let bytes = 0;
  for (const row of rows) bytes += Buffer.byteLength(JSON.stringify(row), "utf8");
  return { rows: rows.length, logical_payload_bytes: bytes };
}

export function recoveryConsumerSummary(
  manifest: RecoveryManifest,
  compressedArtifactBytes: number,
  endedAt: string,
): OfflineConsumerSummary {
  return {
    format: 1,
    consumer: manifest.artifactKind === "full" ? "recovery-full" : "recovery-db-checkpoint",
    run_id: manifest.runId,
    github_run_id: githubRunId(),
    release: manifest.source.deployedReleaseTag,
    source_project: manifest.sourceProjectRef,
    started_at: manifest.createdAt,
    ended_at: endedAt,
    status: "exported",
    rows: null,
    logical_payload_bytes: null,
    dump_file_bytes: manifest.database.files.reduce((total, file) => total + file.bytes, 0),
    snapshot_file_bytes: null,
    compressed_artifact_bytes: compressedArtifactBytes,
    storage_download_bytes: manifest.artifactKind === "full" ? manifest.storage.totalBytes : null,
    storage_objects: manifest.artifactKind === "full" ? manifest.storage.objectCount : null,
    tables: null,
  };
}

export function githubRunId(): string | null {
  const value = process.env.GITHUB_RUN_ID;
  return value && /^\d+$/.test(value) ? value : null;
}

/** Input must be an explicit safe projection, never a snapshot/manifest spread. */
export function reportOfflineConsumer(summary: OfflineConsumerSummary): void {
  try {
    const json = JSON.stringify(summary);
    // Best effort: send only the existing aggregate, never project refs, tables or row data.
    const key = process.env.DB_TRAFFIC_KEY ?? "";
    const endpointValue = process.env.PRODUCT_TELEMETRY_ENDPOINT ?? "";
    try {
      const endpoint = new URL(endpointValue);
      const run = summary.run_id ?? summary.github_run_id;
      if (key.length >= 32 && run && /^[A-Za-z0-9._-]{1,80}$/.test(run) && endpoint.protocol === "https:" && !endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash && endpoint.pathname === "/v1/batches") {
        endpoint.pathname = "/v1/db-offline";
        const release = summary.release && /^[A-Za-z0-9._-]{1,80}$/.test(summary.release) ? summary.release : "unknown";
        const body = JSON.stringify({ consumer: summary.consumer, run, release, started: Date.parse(summary.started_at), ended: Date.parse(summary.ended_at), status: summary.status, rows: summary.rows, logicalBytes: summary.logical_payload_bytes, dumpBytes: summary.dump_file_bytes, snapshotBytes: summary.snapshot_file_bytes, artifactBytes: summary.compressed_artifact_bytes, storageBytes: summary.storage_download_bytes });
        void fetch(endpoint, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body, signal: AbortSignal.timeout(5000), redirect: "error" }).catch(() => {});
      }
    } catch { /* Diagnostics cannot affect successful artifacts. */ }
    console.log(`offline_consumer_summary ${json}`);
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\nOffline consumer accounting (not provider Egress):\n\n\`\`\`json\n${json}\n\`\`\`\n`);
    }
  } catch {
    // Observation cannot invalidate an already completed artifact/export.
    // Neither filesystem errors nor their paths are safe diagnostic context.
    try { console.warn("offline_consumer_accounting_unavailable"); } catch { /* Output is best-effort too. */ }
  }
}
