/** Recovery UI must remain actionable after a failed manual run. Domain rollback
 * and eligibility are protected by real PG; this test only owns the interaction. */
import { expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SchedulerHealthPanel } from "@/components/admin/SchedulerHealthPanel";
import type { SchedulerHealthView } from "@/lib/scheduler/admin";
const mocks = vi.hoisted(() => ({ run: vi.fn(), refresh: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("@/actions/scheduler", () => ({ runSchedulerJobManually: mocks.run }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error } }));

it("refreshes failed health and allows a confirmed recovery run from the same panel", async () => {
  const job: SchedulerHealthView = { jobKey: "match-time-auto-award", label: "比赛时间自动采纳", status: "degraded",
    primaryTriggeredAt: null, dispatchRequestedAt: null, endpointSucceededAt: null, businessTransitionAt: null,
    watchdogSucceededAt: null, manualSucceededAt: null, failureAt: new Date().toISOString() };
  mocks.run.mockResolvedValueOnce({ success: false, error: { code: "INTERNAL_ERROR", requestId: "lineup-incident", message: "服务恢复后运行一次；排查编号：lineup-incident" } })
    .mockResolvedValueOnce({ success: true, data: { businessTransitions: 2 } });
  const user = userEvent.setup();
  render(<SchedulerHealthPanel jobs={[job]} />);
  expect(screen.getByText(/先在比赛工作台核对已保存首发/)).toBeVisible();
  for (let attempt = 0; attempt < 2; attempt++) {
    await user.click(screen.getByRole("button", { name: "立即运行一次" }));
    await user.click(await screen.findByRole("button", { name: "确认运行" }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(attempt + 1));
  }
  expect(mocks.error).toHaveBeenCalledExactlyOnceWith("服务恢复后运行一次；排查编号：lineup-incident");
  expect(mocks.success).toHaveBeenCalledExactlyOnceWith("定时任务已运行。");
  expect(mocks.run).toHaveBeenNthCalledWith(2, { jobKey: "match-time-auto-award" });
});
