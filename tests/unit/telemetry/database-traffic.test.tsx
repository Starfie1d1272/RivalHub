import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { DatabaseTraffic } from "@/components/telemetry/DatabaseTraffic";

const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/telemetry/dashboard", () => ({ getDbTraffic: read }));

it("keeps source and shape rankings within the chosen hour, release and deployment", async () => {
  const metric = (source: string, template: string, rxBytes: number) => ({ source, template, queries: 1, failures: 0, rows: 1, queryMs: 1, logicalRowJsonBytes: 1, logicalMeasuredQueries: 1, rxBytes, skipReasons: { budget: 0, unsupported_value: 0, error: 0 }, rxComplete: true, logicalComplete: true, skipReasonsComplete: true, unsupported: 0, overflow: 0 });
  const window = (hour: number, release: string, deployment: string, source: string, bytes: number) => ({ hour, release, deployment, batches: 1, processes: 1, queries: 1, rows: 1, receivedBytes: bytes, dropped: 0, connections: 1, observedConnections: 1, remainingRxBytes: 0, remaining: { async: 0, no_owner: 0, partial: 0, unsupported: 0, instrumentation: 0 }, rxComplete: true, logicalComplete: true, skipReasonsComplete: true, scopedComplete: true, sources: [metric(source, `shape-${source}`, bytes)], shapes: [metric(source, `shape-${source}`, bytes)], truncated: false });
  read.mockResolvedValue({ status: "ready", data: { start: 0, generatedAt: 7200000, receivedBytes: 300, pending: 0, dropped: 0, offline: [], offlineTruncated: false, windows: [window(3600000, "v1", "a", "mizar", 100), window(3600000, "v2", "b", "dak", 200), window(0, "v2", "b", "bet.fill", 300)] } });
  render(await DatabaseTraffic({ hours: 24, sort: "bytes", selection: { hour: "3600000", release: "v2", deployment: "b" } }));
  expect(screen.getByText("dak · shape-dak")).toBeInTheDocument();
  expect(screen.queryByText("mizar · shape-mizar")).not.toBeInTheDocument();
  expect(screen.queryByText("bet.fill · shape-bet.fill")).not.toBeInTheDocument();
  expect(screen.getByText(/接收 200 · 来源 200 · 未归属 0 · 差额 0 字节/)).toBeInTheDocument();
});
