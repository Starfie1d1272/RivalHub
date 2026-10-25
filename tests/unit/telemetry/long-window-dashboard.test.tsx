import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { LongWindowAnalysis } from "@/components/telemetry/analysis/LongWindowAnalysis";
import { TelemetryLongWindowDashboard } from "@/components/telemetry/TelemetryLongWindowDashboard";
import type { LongWindowSummary } from "@/lib/telemetry/long-window-contract";
import { analysisDefaults } from "@/lib/telemetry/analysis-query";
import { historyBounds } from "@/lib/telemetry/history-contract";
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/components/telemetry/ContentReady", () => ({ ContentReady: () => null }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const range = { from: Date.parse("2026-10-20T00:00:00Z"), to: Date.parse("2026-10-25T00:00:00Z") };
function fixture(): LongWindowSummary {
  return { generatedAt: range.to, validUntil: range.to + 60000, completionBasis: "observed_not_matured",
    requestedRange: range, effectiveRange: range, coveredRanges: [range], source: "history+tail+raw_edges",
    coverage: { status: "partial", segments: [{ ...range, source: "raw_edge", status: "partial", reason: "budget" }], pendingTailBatches: 1, tailBudgetTruncated: false, metricGroupsTruncated: false, rawBudgetTruncated: true, retentionUnknown: false, seriesOmitted: true },
    counts: { views: 13, operations: 3, success: 2, rejected: 0, unknown: 1, pending: 0, taskStarts: 3, taskComplete: 2, taskExposure: null, errors: 0 },
    distinctSessions: null, distinctAccounts: null, metrics: [], unsupportedDimensions: [] };
}
function metric(kind: "task" | "ready", version = 1, basis?: string): LongWindowSummary["metrics"][number] {
  const name = kind === "task" ? "login" : "bet:form";
  const distribution = { n: 0, sum: 0, min: null, max: null, counts: historyBounds(name).map(() => 0).concat(0) };
  return { kind, name, phase: kind === "ready" ? "" : "complete", release: "fixture", measurementVersion: 1, definitionVersion: version, navigationType: "hard", basis,
    duration: distribution, active: distribution, elapsedCensored: true, activeCensored: true, reports: 4 };
}
it("keeps unsupported filters from displaying unfiltered counts, and explains partial coverage and nulls", () => {
  const data = fixture();
  const { rerender } = render(<LongWindowAnalysis data={data} />);
  expect(screen.getByText(/不是成熟窗口完成率/)).toBeInTheDocument();
  expect(screen.getByText("请求范围：", { exact: false })).toBeInTheDocument();
  expect(screen.getByText(/原始边界 · 部分覆盖/)).toBeInTheDocument();
  expect(screen.getAllByText("跨段无法可靠去重")).toHaveLength(2);
  expect(screen.getAllByText("未提供").length).toBeGreaterThan(0);
  rerender(<LongWindowAnalysis data={{ ...data, coverage: { ...data.coverage, status: "unsupported" }, unsupportedDimensions: ["browser"] }} />);
  expect(screen.getByText(/不支持的筛选：浏览器/)).toBeInTheDocument();
  expect(screen.queryByText("页面访问")).not.toBeInTheDocument();
});
it("separates definition versions and ready bases, and never renders censored empty durations as zero", async () => {
  const user = userEvent.setup(); const data = fixture();
  data.metrics = [metric("task", 0), metric("task", 1), metric("task", 2), metric("ready", 0), metric("ready", 0, "demand")];
  render(<LongWindowAnalysis data={data} />);
  const rows = screen.getAllByRole("row").slice(1);
  expect(within(rows[0]!).getByText("定义版本未知")).toBeInTheDocument();
  expect(within(rows[2]!).getByText("定义 v2")).toBeInTheDocument();
  expect(within(rows[3]!).getByText("从导航开始")).toBeInTheDocument();
  expect(within(rows[4]!).getByText("从需求触发开始")).toBeInTheDocument();
  await user.click(within(rows[4]!).getByRole("button"));
  expect(screen.getByRole("heading", { name: /从需求触发开始/ })).toBeInTheDocument();
  expect(screen.getAllByText("无有效时长样本")).toHaveLength(5);
  expect(screen.queryByText(/^0\s*ms$/)).not.toBeInTheDocument();
  expect(screen.getAllByText(/不可完整观测的报告：4/)).toHaveLength(5);
});
it("preserves exact query filters when navigating long-window views and custom dates", async () => {
  const user = userEvent.setup();
  const filters = { ...analysisDefaults, eventId: "11111111-1111-4111-8111-111111111111", role: "super_admin", from: "2026-10-20T00:00:00Z", to: "2026-10-25T00:00:00Z" };
  render(<TelemetryLongWindowDashboard data={fixture()} filters={filters} events={[]} view="tasks" />);
  expect(screen.getByLabelText("赛事").textContent).toContain("所选赛事（目录未提供）");
  const href = new URL(screen.getByRole("link", { name: "页面体验" }).getAttribute("href")!, "http://local");
  expect(href.searchParams.get("from")).toBe(filters.from);
  expect(href.searchParams.get("role")).toBe("super_admin");
  const diagnostic = new URL(screen.getByRole("link", { name: "有界明细分析" }).getAttribute("href")!, "http://local");
  expect(diagnostic.searchParams.get("analysisMode")).toBe("bounded");
  await user.type(screen.getByLabelText("版本精确值"), "fixture-build");
  await user.click(screen.getByRole("button", { name: "应用版本" }));
  const request = new URL(router.push.mock.calls[0]![0], "http://local");
  expect(request.searchParams.get("release")).toBe("fixture-build");
  expect(request.searchParams.get("to")).toBe(filters.to);
  expect(request.searchParams.get("view")).toBe("tasks");
  expect(request.searchParams.get("eventId")).toBe(filters.eventId);
});

it.each(["UTC", "Asia/Shanghai", "America/Los_Angeles"])("hydrates the long-window snapshot in %s without recovery", async timezone => {
  const original = process.env.TZ;
  const data = fixture(); data.metrics = [metric("task", 2), metric("ready", 0, "demand")];
  const view = <TelemetryLongWindowDashboard data={data} filters={analysisDefaults} events={[]} view="overview" />;
  process.env.TZ = "UTC";
  const host = document.createElement("div"); host.innerHTML = renderToString(view); document.body.append(host);
  process.env.TZ = timezone;
  const recovered: unknown[] = [];
  const root = hydrateRoot(host, view, { onRecoverableError: error => recovered.push(error) });
  try { await act(async () => {}); expect(recovered).toEqual([]); }
  finally { await act(async () => root.unmount()); host.remove(); if (original === undefined) delete process.env.TZ; else process.env.TZ = original; }
});

it("uses the provider's merged bucket counts while preserving maximum observations", async () => {
  const user = userEvent.setup(); const data = fixture(); const row = metric("task", 2);
  const bounds = historyBounds(row.name);
  row.elapsedCensored = false; row.activeCensored = false;
  row.duration = { ...row.duration, n: 3, sum: bounds[0]! + 2 * bounds[1]!, min: bounds[0]!, max: bounds[1]!, counts: row.duration.counts.map((_, i) => i === 0 ? 1 : i === 1 ? 2 : 0) };
  data.metrics = [row];
  render(<LongWindowAnalysis data={data} />);
  const table = screen.getAllByRole("table")[1]!;
  const rows = within(table).getAllByRole("row");
  expect(within(rows[1]!).getAllByRole("cell")[1]!.textContent).toBe("1");
  expect(within(rows[2]!).getAllByRole("cell")[1]!.textContent).toBe("2");
  await user.click(screen.getByRole("button", { name: "活跃操作时间" }));
  expect(screen.getByText("此组没有有效时长样本。")).toBeInTheDocument();
});
