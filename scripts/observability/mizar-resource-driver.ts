import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ResourceHttpFixture, ResourceHttpStep } from "./resource-integration-contract";

type ManifestProducer = { credential: string; fixture: { authorityRevision: number; matchId: string };
  liveTemplate: { producedAt: string; cursor: { runtimeSeq: number } }; reliableEnvelope: unknown };
type Manifest = { schemaVersion: string; expiresAt: string; producers: ManifestProducer[] };

/** Consumes G's complete checkout/CLI. Never copies its seed, authority or cleanup rules. */
export async function createMizarResourceDriver(worktree: string, path: string, env: NodeJS.ProcessEnv): Promise<ResourceHttpFixture & { sourceSha: string }> {
  const cwd = resolve(worktree);
  const manifestPath = resolve(path);
  const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
  function command(action: string, requireReceipts = false) {
    try {
      const output = execFileSync(resolve(cwd, "node_modules/.bin/tsx"), ["scripts/db/run-server-cli.ts", "scripts/db/mizar-http-resource-fixture.ts", action, manifestPath,
        ...(requireReceipts ? ["--require-receipts"] : [])], { cwd, env: { ...process.env, ...env }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      const line = output.trim().split("\n").at(-1)!;
      return JSON.parse(line) as { verified?: boolean; expired?: boolean; cleaned?: boolean;
        results?: { receiptCount: number; outcome: string | null; mapCompleted: boolean }[] };
    } catch (error) {
      const stderr = error && typeof error === "object" && "stderr" in error ? String(error.stderr) : "";
      let reason = "FAILED";
      try { const value = JSON.parse(stderr.trim().split("\n").at(-1)!); if (typeof value.reason === "string" && /^[A-Z_]{1,80}$/.test(value.reason)) reason = value.reason; } catch { /* No free text or credentials in the result. */ }
      throw new Error(`G_FIXTURE_${action.toUpperCase()}_${reason}`);
    }
  }
  try {
    command("create");
    const stat = lstatSync(manifestPath);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600 || stat.size > 2_000_000) throw new Error("G_PRIVATE_MANIFEST_REQUIRED");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
    if (manifest.schemaVersion !== "rivalhub.local-mizar-http-resource.v1" || manifest.producers.length !== 2 ||
        manifest.producers[0]!.fixture.matchId === manifest.producers[1]!.fixture.matchId) throw new Error("G_MANIFEST_CONTRACT_MISMATCH");
    const assertFresh = () => { if (Date.now() >= Date.parse(manifest.expiresAt)) throw new Error("G_FIXTURE_WINDOW_EXPIRED"); };
    assertFresh();
    command("verify");
    return { sourceSha, producers: manifest.producers.map(producer => {
      const steps: ResourceHttpStep[] = Array.from({ length: 4 }, (_, index) => ({ operation: "live", authorityRevision: producer.fixture.authorityRevision,
        body(now) { assertFresh(); const frame = structuredClone(producer.liveTemplate); frame.producedAt = now; frame.cursor.runtimeSeq = index + 1; return frame; },
        check(status, body) {
          const result = body as { accepted?: boolean; reason?: string };
          if (status === 200 && result.accepted === true) return "accepted";
          if (status === 200 && result.accepted === false && ["frame_expired", "contended", "delivery_dropped", "broadcast_unavailable"].includes(result.reason ?? "")) return "discarded";
          throw new Error("G_LIVE_HTTP_RESULT_UNEXPECTED");
        } }));
      // G reserves seq=1,000,000: send its exact reliable envelope once, last.
      steps.push({ operation: "reliable", authorityRevision: producer.fixture.authorityRevision,
        body() { assertFresh(); return structuredClone(producer.reliableEnvelope); },
        check(status, body) { const result = body as { outcome?: string; duplicate?: boolean };
          if (status !== 200 || result.outcome !== "canonicalized" || result.duplicate !== false) throw new Error("G_RELIABLE_HTTP_RESULT_UNEXPECTED");
          return "canonicalized";
        } });
      return { credential: producer.credential, intervalMs: 500, steps };
    }),
    async verify(requireReceipts = true) {
      const result = command("verify", requireReceipts);
      return { verified: result.verified === true, expired: result.expired === true,
        receiptCount: (result.results ?? []).reduce((sum, row) => sum + row.receiptCount, 0),
        canonicalized: (result.results ?? []).filter(row => row.outcome === "canonicalized").length,
        mapsCompleted: (result.results ?? []).filter(row => row.mapCompleted).length };
    },
    async cleanup() { const result = command("cleanup"); if (result.cleaned !== true || existsSync(manifestPath)) throw new Error("G_FIXTURE_CLEANUP_NOT_CONFIRMED"); } };
  } catch (error) { if (existsSync(manifestPath)) command("cleanup"); throw error; }
}
