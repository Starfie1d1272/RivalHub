import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { get } from "node:https";
import { expect, it } from "vitest";
import { createLocalTelemetryResourceFixture } from "../../scripts/observability/local-telemetry-resource-fixture";
import { assertResourceTelemetryQuery, resourceTelemetryEndpoint, resourceTelemetryQuery } from "../../scripts/observability/resource-telemetry-contract";

it("rejects an arbitrary 200, the other version's endpoint, wrong counts and forged complete history", () => {
  const raw = resourceTelemetryQuery("/admin/analysis", 200, 100, { totals: { views: 20 } });
  expect(() => assertResourceTelemetryQuery(raw, "raw")).not.toThrow();
  expect(() => assertResourceTelemetryQuery(raw, "summary")).toThrow("TELEMETRY_DATA_COVERAGE_MISMATCH");
  for (const views of [undefined, 0, 19, 21]) expect(() => assertResourceTelemetryQuery(resourceTelemetryQuery("/admin/analysis", 200, 100, { totals: { views } }), "raw")).toThrow();
  for (const status of ["complete", "partial"]) expect(() => assertResourceTelemetryQuery(resourceTelemetryQuery("/admin/long-window", 200, 100,
    { counts: { views: 20 }, coverage: { status, segments: [{ status: "complete" }] } }), "summary")).toThrow("TELEMETRY_HISTORY_GAPS_MISSING");
});

it("serves exact twenty-view raw and genuinely partial summary through trusted local HTTPS with current history schema", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rivalhub-resource-telemetry-"));
  let fixture: Awaited<ReturnType<typeof createLocalTelemetryResourceFixture>> | undefined;
  try {
    fixture = await createLocalTelemetryResourceFixture(directory, "resource-contract-test");
    for (const mode of ["raw", "summary"] as const) {
      const path = resourceTelemetryEndpoint(mode);
      const response = await new Promise<{ status: number; text: string }>((resolve, reject) => {
        get(new URL(path, fixture!.endpoint), { ca: readFileSync(fixture!.ca), headers: { authorization: `Bearer ${fixture!.secret}` } }, result => {
          const chunks: Buffer[] = [];
          result.on("data", chunk => chunks.push(Buffer.from(chunk)));
          result.on("end", () => resolve({ status: result.statusCode!, text: Buffer.concat(chunks).toString() }));
          result.on("error", reject);
        }).on("error", reject);
      });
      const query = resourceTelemetryQuery(path, response.status, Buffer.byteLength(response.text), JSON.parse(response.text));
      expect(() => assertResourceTelemetryQuery(query, mode)).not.toThrow();
      expect(fixture.requests.at(-1)).toEqual(query);
    }
  } finally { await fixture?.close(); rmSync(directory, { recursive: true, force: true }); }
}, 30_000);
