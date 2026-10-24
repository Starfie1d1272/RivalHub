import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import TelemetryDashboard from "@/components/telemetry/TelemetryDashboard";
import { analyzeTelemetry, type Analysis } from "@/lib/telemetry/analysis-model";
import { analysisDefaults } from "@/lib/telemetry/analysis-query";

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
  await user.click(screen.getByRole("button", { name: "会话 001", exact: true }));
  expect(await screen.findByText("A 专属操作")).toBeInTheDocument();
  let fail!: (error: Error) => void;
  query.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
  await user.click(screen.getByRole("button", { name: "会话 002", exact: true }));
  await waitFor(() => expect(query).toHaveBeenCalledTimes(2));
  expect(screen.queryByText("A 专属操作")).not.toBeInTheDocument();
  await act(async () => fail(new Error("fixture failure")));
  expect(await screen.findByText("此会话读取失败，请重试。")).toBeInTheDocument();
  expect(screen.queryByText("A 专属操作")).not.toBeInTheDocument();
});
