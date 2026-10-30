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
  expect(screen.getByText(/已观测接收 200 · 来源 200 · 未归属 0 · 已观测差额 0 字节/)).toBeInTheDocument();
});


it("identifies unknown bytes when connection observation fails", async () => {
  const selected = { hour: 0, release: "v1", deployment: "a", batches: 1, processes: 1, queries: 1, rows: 1, receivedBytes: 0, dropped: 0, connections: 1, observedConnections: 0, remainingRxBytes: 0, remaining: { async: 0, no_owner: 0, partial: 0, unsupported: 0, instrumentation: 0 }, rxComplete: true, logicalComplete: true, skipReasonsComplete: true, scopedComplete: true, sources: [], shapes: [], truncated: false };
  read.mockResolvedValue({ status: "ready", data: { start: 0, generatedAt: 1000, receivedBytes: 0, pending: 0, dropped: 0, offline: [], offlineTruncated: false, windows: [selected], unscopedHours: [] } });
  render(await DatabaseTraffic({ hours: 24, sort: "bytes", selection: {} }));
  expect(screen.getByText(/连接采样时可观测 0 \/ 总数 1；未观测连接的字节未知/)).toBeInTheDocument();
  expect(screen.getByText(/已观测接收 0 · 来源 0 · 未归属 0 · 已观测差额 未提供/)).toBeInTheDocument();
});

it("distinguishes an empty current Worker from one without scoped data", async () => {
  const base = { start: 0, generatedAt: 1000, receivedBytes: 0, pending: 0, dropped: 0, offline: [], offlineTruncated: false };
  read.mockResolvedValueOnce({ status: "ready", data: { ...base, windows: [], unscopedHours: [] } });
  const page = render(await DatabaseTraffic({ hours: 24, sort: "bytes", selection: {} }));
  expect(screen.getByText("暂无已接收分窗数据；采集和投递状态未知。")).toBeInTheDocument();
  page.unmount();
  read.mockResolvedValueOnce({ status: "ready", data: base });
  render(await DatabaseTraffic({ hours: 24, sort: "bytes", selection: {} }));
  expect(screen.getByText("当前 Worker 未提供按版本拆分的来源排行。")).toBeInTheDocument();
});
