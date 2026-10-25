import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:https";
import { resolve } from "node:path";
import { Miniflare } from "miniflare";
import { maintainHistory } from "../../workers/telemetry/history";
import type { Env } from "../../workers/telemetry/index";
import { resourceTelemetryQuery, type ResourceTelemetryQuery } from "./resource-telemetry-contract";
import { signTicket } from "../../src/lib/telemetry/ticket";

const require = createRequire(resolve("package.json"));
// Same declared tsx transpiler path used by scripts/telemetry/measure.mjs.
const { build } = createRequire(require.resolve("tsx/package.json"))("esbuild");
const uuid = (seed: string) => {
  const hex = createHash("sha256").update(seed).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

/** Real Worker/D1 behind a temporary loopback TLS endpoint; never a hosted collector. */
export async function createLocalTelemetryResourceFixture(directory: string, seed: string) {
  const key = resolve(directory, "telemetry.key");
  const cert = resolve(directory, "telemetry.pem");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert,
    "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"], { stdio: "ignore" });
  const bindings = { SIGNING_KEY: "local-resource-signing-".repeat(3), ADMIN_KEY: "local-resource-admin-".repeat(3),
    ALLOWED_ORIGIN: "https://fixture.invalid", ACCEPTING: "1", RETENTION_APPROVED: "1", HISTORY_RETENTION_DAYS: "90" };
  const bundle = await build({ entryPoints: ["workers/telemetry/index.ts"], bundle: true, write: false, format: "esm", platform: "browser" });
  const worker = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2026-07-30", bindings, d1Databases: ["DB"] });
  const requests: ResourceTelemetryQuery[] = [];
  const server = createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (request, response) => {
    void (async () => {
      const path = new URL(request.url ?? "/", "https://fixture.invalid").pathname;
      const result = await worker.dispatchFetch(`https://fixture.invalid${request.url}`, {
        method: request.method, headers: { authorization: request.headers.authorization ?? "" },
      });
      const bytes = new Uint8Array(await result.arrayBuffer());
      let data: unknown;
      try { data = JSON.parse(new TextDecoder().decode(bytes)); } catch { /* Unknown response cannot satisfy data coverage. */ }
      if (requests.length < 256) requests.push(resourceTelemetryQuery(path, result.status, bytes.byteLength, data));
      response.writeHead(result.status, { "content-type": result.headers.get("content-type") ?? "application/json" });
      response.end(bytes);
    })().catch(() => { response.writeHead(500); response.end(); });
  });
  try {
    const database = await worker.getD1Database("DB");
    const statements = readFileSync("workers/telemetry/schema.sql", "utf8").replace(/^--.*$/gm, "").split(";").map(s => s.trim()).filter(Boolean);
    await database.batch(statements.map(sql => database.prepare(sql)));
    const historyEnv = { ...bindings, DB: database } as unknown as Env;
    await maintainHistory(historyEnv, Date.now());
    const now = Date.now();
    const ticket = await signTicket({ v: 1, id: uuid(`${seed}:ticket`), account: null, role: "user", release: "local-resource-fixture",
      environment: "production", origin: bindings.ALLOWED_ORIGIN, exp: now + 3_600_000 }, bindings.SIGNING_KEY);
    // Stable logical cohort and request count. Times are relative to each run.
    for (let batch = 0; batch < 20; batch++) {
      const at = now - batch * 30_000;
      const events = [
        { id: uuid(`${seed}:${batch}:page`), at, session: uuid(`${seed}:session`), route: "/stats", scene: "site", kind: "page" },
        { id: uuid(`${seed}:${batch}:lcp`), at, session: uuid(`${seed}:session`), route: "/stats", scene: "site", kind: "performance", metricName: "LCP", durationMs: 1000 + batch },
      ];
      const result = await worker.dispatchFetch("https://fixture.invalid/v1/batches", { method: "POST", headers: { origin: bindings.ALLOWED_ORIGIN },
        body: JSON.stringify({ v: 1, id: uuid(`${seed}:batch:${batch}`), ticket, events }) });
      if (result.status !== 204) throw new Error(`LOCAL_TELEMETRY_SEED_HTTP_${result.status}`);
    }
    await maintainHistory(historyEnv, Date.now());
    const state = await database.prepare("SELECT started_at FROM history_state WHERE id=1").first();
    if (!state) throw new Error("LOCAL_HISTORY_CHECKPOINT_MISSING");
    await new Promise<void>((resolveReady, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolveReady); });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("LOCAL_TLS_ADDRESS_UNAVAILABLE");
    return { workerHash: createHash("sha256").update(bundle.outputFiles[0].text).digest("hex"), endpoint: `https://127.0.0.1:${address.port}/v1/batches`, secret: bindings.ADMIN_KEY, ca: cert, requests,
      async close() { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); await worker.dispose(); } };
  } catch (error) { if (server.listening) { server.closeAllConnections(); server.close(); } await worker.dispose(); throw error; }
}
