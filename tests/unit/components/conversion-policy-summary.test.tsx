import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { ConversionPolicyAdminRow, ConversionPolicyAdminSummary } from "@/lib/competitive/conversion-policy-admin";
const boundary = vi.hoisted(() => ({ read: vi.fn(), toast: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: boundary.refresh }) }));
vi.mock("sonner", () => ({ toast: { error: boundary.toast, success: vi.fn() } }));
vi.mock("@/actions/conversion-policies", () => ({ readConversionPolicyDetail: boundary.read,
  approveConversionPolicyAction: vi.fn(), createConversionPolicyDraftAction: vi.fn(), retireConversionPolicyAction: vi.fn(), setCurrentConversionPolicyAction: vi.fn(), updateConversionPolicyDraftAction: vi.fn() }));
import { ConversionPolicyManager } from "@/components/admin/ConversionPolicyManager";
const summary: ConversionPolicyAdminSummary = { id: "policy", sourcePlatform: "fivee", targetPlatform: "perfect_world", version: "fixture", status: "approved", isCurrent: true, approvedAt: null, approvedBy: null, approvedByLabel: null, createdAt: new Date("2051-01-01"), eventReferenceCount: 2 };
const detail: ConversionPolicyAdminRow = { ...summary, mapping: { relativeSeasonAlignment: true, belowSRankMap: {}, starSegments: [] }, sourceNote: "private full source", rationale: "full reason", changeSummary: null, internalNote: null, updatedAt: summary.createdAt, eventReferences: [] };
beforeEach(() => { boundary.read.mockReset(); boundary.toast.mockReset(); boundary.read.mockResolvedValue({ success: true, data: detail }); });
it("loads full notes only for the opened detail and preserves them in the editor", async () => {
  render(<ConversionPolicyManager initialPolicies={[summary]} />);
  expect(boundary.read).not.toHaveBeenCalled();
  expect(screen.queryByDisplayValue("private full source")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "查看详情" }));
  expect(await screen.findByDisplayValue("private full source")).toBeVisible();
  expect(boundary.read).toHaveBeenCalledWith("policy");
});
it("fetches copy defaults only when creating a version and fails closed on authorization error", async () => {
  render(<ConversionPolicyManager initialPolicies={[summary]} />);
  fireEvent.click(screen.getByRole("button", { name: "+ 新建版本" }));
  expect(await screen.findByDisplayValue("private full source")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /^取消$/ }));
  boundary.read.mockResolvedValueOnce({ success: false, error: { message: "permission withdrawn" } });
  fireEvent.click(screen.getByRole("button", { name: "查看详情" }));
  await waitFor(() => expect(boundary.toast).toHaveBeenCalledWith("permission withdrawn"));
  expect(screen.queryByDisplayValue("private full source")).not.toBeInTheDocument();
});
it("ignores detail responses after the user closes the loading dialog", async () => {
  let resolve!: (value: unknown) => void;
  boundary.read.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  render(<ConversionPolicyManager initialPolicies={[summary]} />);
  fireEvent.click(screen.getByRole("button", { name: "查看详情" }));
  expect(screen.getByRole("status")).toHaveTextContent("正在读取完整策略");
  fireEvent.click(screen.getByRole("button", { name: /^关闭$/ }));
  await act(async () => { resolve({ success: true, data: detail }); });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
