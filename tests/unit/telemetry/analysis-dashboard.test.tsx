import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import TelemetryDashboard from "@/components/telemetry/TelemetryDashboard";
import { analyzeTelemetry, type Analysis } from "@/lib/telemetry/analysis-model";
import { analysisDefaults } from "@/lib/telemetry/analysis-query";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

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

// The provider deliberately returns the same task name in two definitions.
// A selection must remain specific while its async filter read is pending.
it("selects a task definition independently of another same-name row", async () => {
  const user = userEvent.setup(); const base = sample();
  const first = base.product.tasks[0]!;
  const initial: Analysis = { ...base, filters: { ...base.filters, task: first.key }, product: { ...base.product, tasks: [
    { ...first, definitionVersion: 1 }, { ...first, definitionVersion: 2 },
  ] } };
  query.mockResolvedValue({ status: "ready", data: initial });
  render(<TelemetryDashboard initial={initial} initialView="tasks" events={[]} />);
  expect(screen.queryByRole("heading", { name: first.label })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: `${first.label} · 定义 v2 ↗` }));
  expect(await screen.findByRole("heading", { name: first.label })).toBeInTheDocument();
  expect(window.location.search).toContain("taskDefinition=2");
  const rows = screen.getAllByRole("row");
  expect(within(rows[1]!).getByRole("button").textContent).toContain("定义 v1");
  expect(within(rows[2]!).getByRole("button").textContent).toContain("定义 v2");
});

it("keeps navigation and demand ready rows and chart selection separate", async () => {
  const user = userEvent.setup(); const base = sample();
  const timing = { n: 1, mean: 111, p50: 111, p75: 111, p90: 111, p95: 111, max: 111 };
  const row = { ...timing, route: "/stats", label: "数据中心", module: "stats", moduleLabel: "统计", phase: "primary", phaseLabel: "主要内容", points: [{ ...timing, at: base.meta.capturedAt }] };
  const initial: Analysis = { ...base, product: { ...base.product, ready: [row, { ...row, basis: "demand", p50: 999, points: [{ ...timing, p50: 999, at: base.meta.capturedAt }] }] } };
  render(<TelemetryDashboard initial={initial} initialView="experience" events={[]} />);
  const demandRow = screen.getAllByRole("row").find(row => row.textContent?.includes("从需求触发开始"))!;
  await user.click(within(demandRow).getByRole("button"));
  expect(screen.getByRole("heading", { name: "数据中心 · 统计 · 主要内容 · 从需求触发开始" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "数据中心 · 统计 · 主要内容 · 从导航开始" })).not.toBeInTheDocument();
});
