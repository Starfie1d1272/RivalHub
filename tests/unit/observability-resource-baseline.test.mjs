import { expect, it } from "vitest";
import { assertBaselineReadiness, recordBaselineResponse } from "../../scripts/observability/resource-baseline.mjs";

const identity = { releaseTag: "v0.0.0-local-resource", releaseCommit: "a".repeat(40) };

it("requires a healthy release probe with the exact local build identity", async () => {
  await expect(assertBaselineReadiness(Response.json(identity), identity)).resolves.toEqual(identity);
  await expect(assertBaselineReadiness(Response.json(identity, { status: 503 }), identity)).rejects.toThrow("Readiness HTTP 503");
  await expect(assertBaselineReadiness(Response.json({ ...identity, releaseCommit: "b".repeat(40) }), identity)).rejects.toThrow("identity mismatch");
  await expect(assertBaselineReadiness(new Response("not JSON"), identity)).rejects.toThrow("invalid build identity");
});

it("retains failed HTTP samples and rejects the run's request operation", async () => {
  const raw = [];
  await expect(recordBaselineResponse(new Response("fixture failure", { status: 500 }), raw, "/stats", "concurrent12", performance.now())).rejects.toThrow("Unexpected HTTP 500");
  expect(raw).toEqual([expect.objectContaining({ route: "/stats", phase: "concurrent12", status: 500, bytes: 15 })]);
  await expect(recordBaselineResponse(new Response("ok"), raw, "/stats", "warm", performance.now())).resolves.toMatchObject({ status: 200, bytes: 2 });
  expect(raw).toHaveLength(2);
});
