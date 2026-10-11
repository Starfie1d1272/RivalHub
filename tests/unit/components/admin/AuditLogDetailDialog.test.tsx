import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import type { AuditLogDetail, AuditLogView } from "@/lib/audit/presentation";
import { AuditLogDetailDialog } from "@/components/admin/AuditLogDetailDialog";

const fetchDetail = vi.hoisted(() => vi.fn());
vi.mock("@/actions/audit", () => ({ fetchAuditLogDetail: fetchDetail }));

const log: AuditLogView = {
  id: "log-1", createdAt: "2026-10-11T00:00:00.000Z", actionKey: "postmatch.report.revoke",
  actionLabel: "撤销赛后提交", categoryLabel: "赛后", categoryColor: "var(--color-fg-dim)",
  actorLabel: "管理员甲", targetTypeLabel: "比赛", targetLabel: "甲队 vs 乙队", summary: null,
};
const detail: AuditLogDetail = {
  ...log, seasonLabel: "Major 2026", description: "重新开放整理", authorizedByLabel: null,
  targetContext: "决赛", targetHref: "/admin/seasons/major/matches/match-1",
  fields: [{ label: "提交状态", value: "已提交 → 待整理" }],
};
function deferred() {
  let resolve!: (result: { success: true; data: AuditLogDetail }) => void;
  const promise = new Promise<{ success: true; data: AuditLogDetail }>((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => vi.resetAllMocks());

it("loads detail only on demand with the explicit event and season scope", async () => {
  const user = userEvent.setup();
  const request = deferred();
  fetchDetail.mockReturnValueOnce(request.promise);
  render(<AuditLogDetailDialog log={log} seasonScopeId="season-1" />);
  expect(fetchDetail).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "查看撤销赛后提交详情" }));
  expect(fetchDetail).toHaveBeenCalledExactlyOnceWith({ id: "log-1", seasonScopeId: "season-1" });
  expect(screen.getByRole("status")).toHaveTextContent("正在加载详情");
  await act(async () => request.resolve({ success: true, data: detail }));
  expect(await screen.findByText("已提交 → 待整理")).toBeVisible();
  expect(screen.getByText("Major 2026")).toBeVisible();
  expect(screen.getByRole("link", { name: "打开比赛工作台" })).toHaveAttribute("href", detail.targetHref);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it.each(["action failure", "transport failure"])("shows %s and retries the same scoped detail request", async (failure) => {
  const user = userEvent.setup();
  if (failure === "action failure") fetchDetail.mockResolvedValueOnce({ success: false, error: { code: "FORBIDDEN", message: "无权查看此记录。" } });
  else fetchDetail.mockRejectedValueOnce(new Error("network failure"));
  fetchDetail.mockResolvedValueOnce({ success: true, data: detail });
  render(<AuditLogDetailDialog log={log} seasonScopeId="season-1" />);
  await user.click(screen.getByRole("button", { name: "查看撤销赛后提交详情" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(failure === "action failure" ? "无权查看此记录。" : "日志详情加载失败，请重试。");
  const retry = screen.getByRole("button", { name: "重试" });
  await waitFor(() => expect(retry).toBeEnabled());
  await user.click(retry);
  expect(await screen.findByText("已提交 → 待整理")).toBeVisible();
  expect(fetchDetail).toHaveBeenNthCalledWith(2, { id: "log-1", seasonScopeId: "season-1" });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("ignores a closed dialog's late result after reopening for a fresh request", async () => {
  const user = userEvent.setup();
  const oldRequest = deferred();
  const newRequest = deferred();
  fetchDetail.mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(newRequest.promise);
  render(<AuditLogDetailDialog log={log} />);
  await user.click(screen.getByRole("button", { name: "查看撤销赛后提交详情" }));
  await user.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "查看撤销赛后提交详情" }));
  expect(fetchDetail).toHaveBeenNthCalledWith(2, { id: "log-1" });
  await act(async () => {
    newRequest.resolve({ success: true, data: { ...detail, description: "最新详情" } });
    oldRequest.resolve({ success: true, data: { ...detail, description: "已关闭请求的旧详情" } });
  });
  expect(await screen.findByText("最新详情")).toBeVisible();
  expect(screen.queryByText("已关闭请求的旧详情")).not.toBeInTheDocument();
});
