import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, writeFileSync } from "node:fs";
import type { RecoveryManifest, RecoverySidecar } from "./manifest";

/** This record is operational evidence, not an authorization or an identity ledger. */
export function startRecoveryRecord(path: string, manifest: RecoveryManifest, sidecar: RecoverySidecar, databaseUrl: string, instanceIdentity: string, apiUrl?: string): string {
  const run = randomUUID();
  const db = new URL(databaseUrl);
  // Never persist credentials or connection parameters. Endpoint identity is not
  // proof that a replacement instance at the same address is the same target.
  const target = createHash("sha256").update(JSON.stringify([db.hostname, db.port || "5432", db.pathname, apiUrl ? new URL(apiUrl).origin : null])).digest("hex");
  writeFileSync(path, `${JSON.stringify({ version: 1, event: "started", recoveryRun: run, snapshotRun: manifest.runId, artifactSha256: sidecar.artifactSha256, artifactKind: manifest.artifactKind, targetEndpointSha256: target, targetInstanceSha256: createHash("sha256").update(instanceIdentity).digest("hex"), migrationTerminal: manifest.source.databaseMigrationTerminal, reconciliationCoverage: null, providerState: "unknown", at: new Date().toISOString() })}\n`, { flag: "wx", mode: 0o600 });
  return run;
}

export function recordDataVerification(path: string, run: string): void {
  appendFileSync(path, `${JSON.stringify({ version: 1, event: "data-verified", recoveryRun: run, readiness: "blocked", at: new Date().toISOString() })}\n`);
}

/** No owner can yet supply independent revocation or identity reconciliation evidence. */
export function assertRecoveryReady(): never {
  throw new Error("Recovery is not ready for traffic: independent revocation, identity reconciliation and provider evidence are not implemented (#904). Data verification is not authorization.");
}

if (process.argv[1]?.endsWith("readiness.ts")) {
  try { assertRecoveryReady(); } catch (error) {
    console.error(error instanceof Error ? error.message : "Recovery is not ready.");
    process.exitCode = 1;
  }
}
