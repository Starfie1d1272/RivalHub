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

it("filters retained shapes before limiting, reports overflow and preserves the selected scope in every sort", async () => {
  const metric = (source: string, template: string, rxBytes: number) => ({ source, template, queries: 2, failures: 1, rows: 1, queryMs: 1, logicalRowJsonBytes: 1, logicalMeasuredQueries: 1, rxBytes, skipReasons: { budget: 0, unsupported_value: 0, error: 0 }, rxComplete: true, logicalComplete: true, skipReasonsComplete: true });
  const shapes = [...Array.from({ length: 21 }, (_, i) => metric("dak", `q${i}`, 10)), metric("dak", "overflow", 20), metric("mizar", "other", 500)];
  const selected = { hour: 3600000, release: "v2", deployment: "unknown", batches: 1, processes: 1, queries: 46, rows: 1, receivedBytes: 780, dropped: 0, connections: 1, observedConnections: 1, remainingRxBytes: 0, remaining: { async: 0, no_owner: 0, partial: 0, unsupported: 0, instrumentation: 0 }, rxComplete: true, logicalComplete: true, skipReasonsComplete: true, scopedComplete: true, sources: [{ ...metric("dak", "", 280), overflow: 2, unsupported: 0 }, { ...metric("mizar", "", 500), overflow: 0, unsupported: 0 }], shapes, truncated: true };
  const earlier = { ...selected, hour: 0, release: "v1", shapes: [metric("mizar", "old", 3)] };
  read.mockResolvedValue({ status: "ready", data: { start: 0, generatedAt: 7200000, receivedBytes: 783, pending: 0, dropped: 0, offline: [], offlineTruncated: false, windows: [earlier, selected] } });
  render(await DatabaseTraffic({ hours: 24, sort: "bytes", selection: { hour: "3600000", release: "v2", deployment: "unknown", source: "dak" } }));
  expect(screen.getByText(/App release v2 · deployment unknown/)).toBeInTheDocument();
  expect(screen.getByText("dak · q20")).toBeInTheDocument();
  expect(screen.queryByText("mizar · other")).not.toBeInTheDocument();
  expect(screen.getByText(/保留形态 230 字节（其中保留的 overflow 20）；来源总量与保留形态的差额 50 字节。overflow 查询 2 次/)).toBeInTheDocument();
  expect(screen.getByText(/280 协议字节 · 2 次 · 失败 1 · overflow 2 次/)).toBeInTheDocument();
  for (const [label, order] of [["协议字节", "bytes"], ["次数", "queries"], ["耗时", "time"], ["行数", "rows"]]) {
    const url = new URL(screen.getByRole("link", { name: `按${label}` }).getAttribute("href")!, "https://example.test");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ hour: "3600000", release: "v2", deployment: "unknown", sort: order, source: "dak" });
  }
});

it("shows an hour containing only quarantined batches", async () => {
  read.mockResolvedValue({ status: "ready", data: { start: 0, generatedAt: 7200000, receivedBytes: 0, pending: 0, dropped: 0, offline: [], offlineTruncated: false, windows: [], quality: [{ hour: 3600000, release: "v1", deployment: "d1", batches: 1, reasons: { received_sum: 1 }, truncated: false }], qualityDetails: [{ at: 3600001, batch: { receivedBytes: 2 }, reasons: ["received_sum"] }], qualityDetailsTruncated: false } });
  render(await DatabaseTraffic({ hours: 24, sort: "bytes", selection: {} }));
  expect(screen.getByRole("link", { name: /1 批质量异常/ })).toBeInTheDocument();
  expect(screen.queryByText("暂无已接收分窗数据；采集和投递状态未知。")).not.toBeInTheDocument();
  expect(screen.getByText(/异常数据未计入可信流量汇总/)).toBeInTheDocument();
});

it("includes separately reported gaps and flags incomplete loss totals", async () => {
  read.mockResolvedValue({ status: "ready", data: { start: 0, generatedAt: 7200000, receivedBytes: 0, pending: 0, dropped: 0, lossComplete: true, offline: [], offlineTruncated: false, windows: [], qualityPending: 1, quality: [{ hour: 3600000, release: "v1", deployment: "d1", batches: 0, reasons: {}, lostBatches: 3, lostBytes: 20, unconfirmedBatches: 2, truncated: false }] } });
  render(await DatabaseTraffic({ hours: 24, sort: "bytes", selection: {} }));
  expect(screen.getByText("部分提供 3")).toBeInTheDocument();
  expect(screen.getByText(/缺口已知丢失 3 批 \/ 20 字节；旧窗口 0。缺口未确认 2 批/)).toBeInTheDocument();
});

it("shows historical unknown coverage across the whole range without claiming current failure", async () => {
  const base = { start: 0, generatedAt: 10800000, receivedBytes: 0, pending: 0, dropped: 0, lossComplete: true, offline: [], offlineTruncated: false, windows: [], qualityPending: 1, qualityTruncated: true };
  read.mockResolvedValue({ status: "ready", data: { ...base, quality: [{ hour: 3600000, release: "old-release", deployment: "old-deploy", batches: 0, reasons: {}, coverageUnknownSince: 1000, truncated: false }, { hour: 7200000, release: "new-release", deployment: "new-deploy", batches: 0, reasons: {}, truncated: false }] } });
  render(await DatabaseTraffic({ hours: 24, sort: "bytes", selection: { hour: "7200000", release: "new-release", deployment: "new-deploy" } }));
  expect(screen.getByText(/报告小时 .*old-release \/ old-deploy · 未知始于/)).toBeInTheDocument();
  expect(screen.getByText(/历史记录不表示当前仍有故障，未报告丢失也不能证明覆盖完整。质量记录待汇总或已截断/)).toBeInTheDocument();
});

it("does not interpret an absence of reported unknown coverage as proof of completeness", async () => {
  read.mockResolvedValue({ status: "ready", data: { start: 0, generatedAt: 1000, receivedBytes: 0, pending: 0, dropped: 0, lossComplete: true, offline: [], offlineTruncated: false, windows: [], quality: [] } });
  render(await DatabaseTraffic({ hours: 24, sort: "bytes", selection: {} }));
  expect(screen.getByText("此范围暂无已汇总的覆盖未知记录。")).toBeInTheDocument();
  expect(screen.getByText(/未报告丢失也不能证明覆盖完整/)).toBeInTheDocument();
});
