/** Approved anonymous browser -> real receiver -> D1-backed read verification. No business mutations. */
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { UUID, type Bootstrap, type TelemetryEvent } from "../../src/lib/telemetry/protocol";

let stage = "configuration";
async function main() {
  const site = new URL(process.env.PRODUCT_TELEMETRY_ORIGIN ?? "");
  const endpoint = new URL(process.env.PRODUCT_TELEMETRY_ENDPOINT ?? "");
  const release = process.env.TELEMETRY_EXPECTED_COMMIT ?? "";
  const environment = process.env.TELEMETRY_EXPECTED_ENVIRONMENT;
  const admin = process.env.PRODUCT_TELEMETRY_ADMIN_KEY ?? "";
  assert(site.protocol === "https:" && site.href === `${site.origin}/` && !site.username && !site.password, "Require bare HTTPS site origin");
  assert(endpoint.protocol === "https:" && endpoint.pathname === "/v1/batches" && !endpoint.search && !endpoint.hash && !endpoint.username && !endpoint.password, "Require exact HTTPS /v1/batches endpoint");
  assert(/^[a-f0-9]{40}$/.test(release) && ["preview", "production"].includes(environment ?? ""), "Set expected exact commit and environment");
  assert(admin.length >= 32, "Missing receiver operator key");
  assert(process.env.TELEMETRY_ALLOW_LIVE_SMOKE === "1", "Live collection approval required; set TELEMETRY_ALLOW_LIVE_SMOKE=1 only after approval");

  // Never inject a ticket or patched client: the deployed Header must bootstrap the real observer.
  stage = "browser";
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const acknowledged = page.waitForResponse(response => response.url() === endpoint.href && response.request().method() === "POST" && response.status() === 204, { timeout: 75000 });
    // Attach a rejection handler while navigation/bootstrap checks run, without swallowing its result.
    void acknowledged.catch(() => {});
    const home = await page.goto(site.origin, { waitUntil: "domcontentloaded" });
    assert(home?.ok(), "Website navigation failed");
    assert.equal(new URL(page.url()).origin, site.origin, "Website redirected outside approved origin");
    stage = "bootstrap";
    const bootstrap = await page.evaluate(async () => {
      const response = await fetch("/api/product-telemetry", { method: "POST", cache: "no-store" });
      if (!response.ok) return null;
      return response.json();
    }) as Bootstrap | null;
    assert(bootstrap?.endpoint === endpoint.href, "Deployed bootstrap is disabled or collector does not match");
    // This POST issues no events; first ingestion must come from the deployed observer's normal timer.
    stage = "delivery";
    const accepted = await acknowledged;
    const request = accepted.request();
    const headers = await request.allHeaders();
    assert(!headers.cookie && !headers.referer && headers.origin === site.origin, "Collector must receive no cookies/referrer and exact allowed origin");
    assert((headers["content-type"] ?? "").startsWith("text/plain"), "Expected simple batched request");
    assert(accepted.headers()["access-control-allow-origin"] === site.origin, "Collector CORS origin mismatch");
    const payload = request.postDataJSON() as { id: string; events: TelemetryEvent[] };
    const session = payload.events?.[0]?.session;
    assert(UUID.test(payload.id) && session && UUID.test(session), "Missing batch/session identifiers");
    assert(payload.events.some(event => event.kind === "page" && event.route === "/"), "Observer did not send the loaded page");
    stage = "storage-readback";
    const read = new URL("/admin/events", endpoint);
    read.searchParams.set("session", session);
    const response = await fetch(read, { headers: { authorization: `Bearer ${admin}` }, redirect: "error", signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, 200, "D1-backed operator read failed");
    const stored = await response.json() as { batches: { id: string; release: string; environment: string; account: string | null; role: string; events: string }[] };
    const batch = stored.batches.find(value => value.id === payload.id);
    assert(batch, "ACKed browser batch missing from D1-backed query");
    assert.equal(batch.release, release);
    assert.equal(batch.environment, environment);
    assert.equal(batch.account, null);
    assert.equal(batch.role, "anonymous");
    assert.deepEqual(JSON.parse(batch.events), payload.events, "Compressed stored events did not round-trip");
    stage = "access-boundaries";
    const denied = await fetch(new URL("/admin/usage", endpoint), { redirect: "error", signal: AbortSignal.timeout(10000) });
    assert.equal(denied.status, 401, "Unauthenticated operator reads must fail");
    const crossOrigin = await fetch(endpoint, { method: "POST", headers: { origin: "https://not-the-approved-origin.invalid" }, body: "{}", redirect: "error", signal: AbortSignal.timeout(10000) });
    assert.equal(crossOrigin.status, 403, "Cross-origin collection must fail");
    // Only aggregate evidence leaves this process. No HAR, ticket, account, raw events, or operator key.
    console.log(JSON.stringify({ verified: true, site: site.origin, collector: endpoint.origin, release, environment,
      acknowledgedBatches: 1, roundTrippedEvents: payload.events.length, anonymous: true, noCookieOrReferrer: true,
      unauthenticatedRead: denied.status, crossOriginIngest: crossOrigin.status }, null, 2));
  } finally { await browser.close(); }
}

main().catch(() => { console.error(`Live telemetry verification failed at ${stage}. Check approved configuration and access; no payload or credentials logged.`); process.exitCode = 1; });
