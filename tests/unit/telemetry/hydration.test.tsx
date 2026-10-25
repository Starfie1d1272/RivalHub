import { act } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import TelemetryDashboard from "@/components/telemetry/TelemetryDashboard";
import { analyzeTelemetry } from "@/lib/telemetry/analysis-model";
import { analysisDefaults } from "@/lib/telemetry/analysis-query";

vi.mock("@/components/telemetry/ContentReady", () => ({ ContentReady: () => null }));
vi.mock("@/app/admin/telemetry/actions", () => ({ getTelemetryAnalysisAction: vi.fn() }));

const originalTZ = process.env.TZ;
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  if (originalTZ === undefined) delete process.env.TZ;
  else process.env.TZ = originalTZ;
  window.history.replaceState(null, "", "/");
});

// Reuse one server payload: changing browser time/timezone must not alter its
// first render, including Radix IDs, dates, chart paths and HTML nesting.
it.each(["UTC", "Asia/Shanghai", "America/Los_Angeles"])("hydrates the server snapshot in %s without recovery", async timezone => {
  const now = Date.parse("2026-10-25T23:59:59.000Z");
  const initial = analyzeTelemetry({
    capturedAt: now, batches: 1, bytes: 500, oldest: now - 1000,
    events: [{ id: "a", at: now - 500, received: now - 500, expires: now + 60000,
      session: "a".repeat(32), account: null, role: "anonymous", release: "fixture",
      route: "/", scene: "site", eventId: null, kind: "page" }],
    metricIds: [], usage: { budget: { batches: 5000, bytes: 8388608 }, usage: [], expiredBatches: 0 },
    truncated: false, validUntil: now + 60000,
  }, { ...analysisDefaults, hours: "6" });
  process.env.TZ = "UTC";
  const view = <TelemetryDashboard initial={initial} events={[]} />;
  const markup = renderToString(view);
  const host = document.createElement("div");
  host.innerHTML = markup;
  document.body.append(host);
  process.env.TZ = timezone;
  expect(renderToString(view)).toBe(markup);
  window.history.replaceState(null, "", "/admin/telemetry");
  const recovered: unknown[] = [];
  await act(async () => {
    root = hydrateRoot(host, view, { onRecoverableError: error => recovered.push(error) });
  });
  expect(recovered).toEqual([]);
});
