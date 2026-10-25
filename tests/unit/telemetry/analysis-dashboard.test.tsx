import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import TelemetryDashboard from "@/components/telemetry/TelemetryDashboard";
import { analyzeTelemetry, type Analysis } from "@/lib/telemetry/analysis-model";
import { analysisDefaults } from "@/lib/telemetry/analysis-query";

vi.mock("@/components/telemetry/ContentReady", () => ({ ContentReady: () => null }));

const query = vi.hoisted(() => vi.fn());
vi.mock("@/app/admin/telemetry/actions", () => ({ getTelemetryAnalysisAction: query }));
afterEach(() => { cleanup(); query.mockReset(); window.history.replaceState(null, "", "/"); });
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
it("keeps a previous session's timeline out of a newly selected session and a failed read", async () => {
  const user = userEvent.setup();
  const initial = sample();
  render(<TelemetryDashboard initial={initial} events={[]} />);
  await user.click(screen.getByRole("button", { name: "问题排查" }));
  const a: Analysis = { ...initial, timeline: [{ at: Date.now(), label: "A 专属操作", kind: "page", phase: "", route: "首页", detail: "", duration: null, requestId: null }] };
  query.mockResolvedValueOnce({ status: "ready", data: a });
  await user.click(screen.getByRole("button", { name: /会话 001/ }));
  expect(await screen.findByText("A 专属操作")).toBeInTheDocument();
  query.mockResolvedValueOnce({ status: "ready", data: initial });
  await user.click(screen.getByRole("button", { name: "关闭会话" }));
  expect(await screen.findByRole("button", { name: /会话 002/ })).toBeInTheDocument();
  let fail!: (error: Error) => void;
  query.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
  await user.click(screen.getByRole("button", { name: /会话 002/ }));
  await waitFor(() => expect(query).toHaveBeenCalledTimes(3));
  expect(query.mock.calls[2]![0].session).toBe(initial.sessions[1]!.key);
  expect(screen.queryByText("A 专属操作")).not.toBeInTheDocument();
  await act(async () => fail(new Error("fixture failure")));
  expect(await screen.findByText("当前条件读取失败，请点击刷新重试。")).toBeInTheDocument();
  expect(screen.queryByText("A 专属操作")).not.toBeInTheDocument();
});

it("handles schema-allowed empty trends and missing metrics without a render exception", async () => {
  const user = userEvent.setup();
  const base = sample();
  const initial = { ...base, buckets: [], metrics: [], histograms: [], performanceRoutes: [], metricDevices: [],
    product: { ...base.product, ready: [], performanceTrends: [] } };
  render(<TelemetryDashboard initial={initial} events={[]} />);
  await user.click(screen.getByRole("button", { name: "页面体验" }));
  expect(screen.getByRole("heading", { name: "浏览器性能" })).toBeInTheDocument();
  expect(screen.getByText("尚无内容就绪样本；需要页面接入就绪标记并启用增强采集。")).toBeInTheDocument();
  expect(query).not.toHaveBeenCalled();
});

it("ignores an old session result after history navigation and a new session selection", async () => {
  const user = userEvent.setup();
  const initial = sample();
  render(<TelemetryDashboard initial={initial} events={[]} />);
  await user.click(screen.getByRole("button", { name: "问题排查" }));
  let resolveOld!: (value: unknown) => void;
  query.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
  await user.click(screen.getByRole("button", { name: /会话 001/ }));
  await waitFor(() => expect(query).toHaveBeenCalledTimes(1));
  query.mockResolvedValueOnce({ status: "ready", data: initial });
  await act(async () => {
    window.history.replaceState(null, "", "/admin/telemetry?hours=6&view=problems");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await screen.findByRole("button", { name: /会话 002/ });
  const timeline = (label: string): Analysis => ({ ...initial, timeline: [{ at: Date.now(), label, kind: "page", phase: "", route: "首页", detail: "", duration: null, requestId: null }] });
  query.mockResolvedValueOnce({ status: "ready", data: timeline("B 专属操作") });
  await user.click(screen.getByRole("button", { name: /会话 002/ }));
  expect(await screen.findByText("B 专属操作")).toBeInTheDocument();
  await act(async () => resolveOld({ status: "ready", data: timeline("A 迟到结果") }));
  expect(screen.getByText("B 专属操作")).toBeInTheDocument();
  expect(screen.queryByText("A 迟到结果")).not.toBeInTheDocument();
});
