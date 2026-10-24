import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import TelemetryDashboard from "@/components/telemetry/TelemetryDashboard";
import { analyzeTelemetry, type Analysis } from "@/lib/telemetry/analysis-model";
import { analysisDefaults } from "@/lib/telemetry/analysis-query";

vi.mock("@/components/telemetry/ContentReady", () => ({ ContentReady: () => null }));

const query = vi.hoisted(() => vi.fn());
vi.mock("@/app/admin/telemetry/actions", () => ({ getTelemetryAnalysisAction: query }));
afterEach(() => { cleanup(); query.mockReset(); });
const sample = () => {
  const now = Date.now();
  return analyzeTelemetry({
    capturedAt: now, batches: 1, bytes: 500, oldest: now - 1000,
    events: ["a", "b"].map((key) => ({ id: key, at: now - 500, received: now - 500,
      expires: now + 60000, session: key.repeat(32), account: null, role: "anonymous",
      release: "fixture", route: "/", scene: "site", eventId: null, kind: "page" })),
    metricIds: [], usage: { budget: { batches: 5000, bytes: 8388608 }, usage: [], expiredBatches: 0 },
    truncated: false, validUntil: now + 60000,
  }, { ...analysisDefaults, hours: "6" });
};
// Protect session attribution during pending/failed/out-of-order reads, not component layout.
it("keeps a previous session's timeline out of a newly selected session", async () => {
  const user = userEvent.setup();
  const initial = sample();
  render(<TelemetryDashboard initial={initial} />);
  expect(screen.getByText("页面访问 · 按小时")).toBeInTheDocument();
  await user.click(screen.getByRole("tab", { name: "使用行为" }));
  await user.click(screen.getByRole("tab", { name: "会话路径" }));
  const a: Analysis = { ...initial, timeline: [{ at: Date.now(), label: "A 专属操作", kind: "page", phase: "", route: "首页", detail: "", duration: null, requestId: null }] };
  query.mockResolvedValueOnce({ status: "ready", data: a });
  await user.click(screen.getByRole("button", { name: /^会话 001$/ }));
  expect(await screen.findByText("A 专属操作")).toBeInTheDocument();
  let fail!: (error: Error) => void;
  query.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
  await user.click(screen.getByRole("button", { name: /^会话 002$/ }));
  await waitFor(() => expect(query).toHaveBeenCalledTimes(2));
  expect(screen.queryByText("A 专属操作")).not.toBeInTheDocument();
  await act(async () => fail(new Error("fixture failure")));
  expect(await screen.findByText("此会话读取失败，请重试。")).toBeInTheDocument();
  expect(screen.queryByText("A 专属操作")).not.toBeInTheDocument();
});

it("handles schema-allowed empty trends and missing metrics without a render exception", async () => {
  const user = userEvent.setup();
  const initial = { ...sample(), buckets: [], metrics: [], histograms: [] };
  render(<TelemetryDashboard initial={initial} />);
  await user.click(screen.getByRole("tab", { name: "页面性能" }));
  expect(screen.getByText("当前数据缺少所选指标或分布，请选择其他指标或刷新分析。")).toBeInTheDocument();
  expect(query).not.toHaveBeenCalled();
});

it("coalesces a burst of session choices into the final authorized read", async () => {
  const user = userEvent.setup();
  const initial = sample();
  query.mockResolvedValue({ status: "ready", data: initial });
  render(<TelemetryDashboard initial={initial} />);
  await user.click(screen.getByRole("tab", { name: "使用行为" }));
  await user.click(screen.getByRole("tab", { name: "会话路径" }));
  fireEvent.click(screen.getByRole("button", { name: /^会话 001$/ }));
  fireEvent.click(screen.getByRole("button", { name: /^会话 002$/ }));
  await waitFor(() => expect(query).toHaveBeenCalledTimes(1));
  expect(query.mock.calls[0]![0].session).toBe(initial.sessions[1]!.key);
});

it("keeps other metric choices available when the current LCP is missing", async () => {
  const user = userEvent.setup();
  const base = sample();
  const initial = { ...base, metrics: base.metrics.filter(metric => metric.key !== "LCP"), histograms: base.histograms.filter(histogram => histogram.metric !== "LCP") };
  render(<TelemetryDashboard initial={initial} />);
  await user.click(screen.getByRole("tab", { name: "页面性能" }));
  expect(screen.getByText("当前数据缺少所选指标或分布，请选择其他指标或刷新分析。")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /交互响应.*P75/ }));
  expect(screen.queryByText("当前数据缺少所选指标或分布，请选择其他指标或刷新分析。")).not.toBeInTheDocument();
  expect(screen.getByText("交互响应分布")).toBeInTheDocument();
});
