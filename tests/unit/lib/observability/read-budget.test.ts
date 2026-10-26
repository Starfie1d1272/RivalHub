import { expect, it, vi } from "vitest";
import { getReadBudgetSnapshot, recordBetAggregateFallback, recordMizarHttpResult } from "@/lib/observability/read-budget";
import { mizarContextResponse, withMizarRequest } from "@/lib/mizar/http";
import { sanitizeSafeContext } from "@/lib/observability/redact";
vi.mock("@/lib/observability/route", () => ({ withRouteObservability: (_request: Request, _route: string, run: (ctx: object) => unknown) => run({}) }));
vi.mock("@/lib/observability/server", () => ({ captureException: vi.fn() }));

it("counts 304 without inferring saved database work, encoded UTF-8 only once, and shares fixed counters across graphs", async () => {
  const before = getReadBudgetSnapshot();
  const doc = { revision: "fixture", schemaVersion: "rivalhub.broadcast-manifest.v1", title: "比赛" };
  const request = new Request("http://localhost/api/mizar/match");
  const response = await withMizarRequest(request, "/api/mizar/[operation]", "get", async diagnostics => {
    diagnostics.operation = "match";
    return mizarContextResponse(request, doc);
  });
  expect(response.headers.get("content-type")).toBe("application/json");
  expect(await response.json()).toEqual(doc);
  const cached = mizarContextResponse(new Request(request, { headers: { "if-none-match": '"fixture"' } }), doc);
  recordMizarHttpResult("match", cached.status);
  expect(cached.status).toBe(304);
  expect(await cached.text()).toBe("");
  recordMizarHttpResult("match", 401);
  recordMizarHttpResult("match", undefined);
  recordMizarHttpResult("private-id" as never, 200);
  recordBetAggregateFallback();
  vi.resetModules();
  const other = await import("@/lib/observability/read-budget");
  const after = other.getReadBudgetSnapshot();
  const a = after.mizar[0], b = before.mizar[0];
  expect(a).toMatchObject({ family: "match", requests: b.requests + 4, status200: b.status200 + 1, status304: b.status304 + 1,
    failures: b.failures + 2, encodedResponses: b.encodedResponses + 2,
    encodedBodyBytes: b.encodedBodyBytes + Buffer.byteLength(JSON.stringify(doc)) });
  expect(after.mizar).toHaveLength(2);
  expect(after.betFallbacks).toBe(before.betFallbacks + 1);
  a.requests = -100;
  expect(other.getReadBudgetSnapshot().mizar[0].requests).toBeGreaterThan(0);
});

it("new metric fields accept numbers only, never identities or unknown as zero", () => {
  const fields = { cgroupCurrentBytes: 12, cgroupPeakBytes: 15, cgroupOom: 0, cgroupOomKill: 0,
    returnedRows: 4, queryMs: 12, unsupported: 0, requests: 3, status200: 1, status304: 1, other: 0, failures: 1, encodedResponses: 2, encodedBodyBytes: 35 };
  expect(sanitizeSafeContext(fields)).toEqual(fields);
  expect(sanitizeSafeContext(Object.fromEntries(Object.keys(fields).map(key => [key, "private-viewer"])))).toEqual({});
  expect(sanitizeSafeContext({ cgroupCurrentBytes: null, viewer: { userId: "private" }, displayName: "private" })).toEqual({});
});
