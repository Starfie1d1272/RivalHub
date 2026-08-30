/**
 * @vitest-environment jsdom
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DisciplineManagement, type DisciplineSanctionRow } from "@/components/admin/DisciplineManagement";

Object.assign(globalThis, { React });

const { issueSanctionMock, revokeSanctionMock, expireSanctionMock, searchSanctionSubjectsMock, refreshMock } = vi.hoisted(() => ({
  issueSanctionMock: vi.fn(),
  revokeSanctionMock: vi.fn(),
  expireSanctionMock: vi.fn(),
  searchSanctionSubjectsMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("@/actions/discipline", () => ({
  issueSanction: issueSanctionMock,
  revokeSanction: revokeSanctionMock,
  expireSanction: expireSanctionMock,
  searchSanctionSubjects: searchSanctionSubjectsMock,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function row(overrides: Partial<DisciplineSanctionRow> = {}): DisciplineSanctionRow {
  return {
    id: "case-1",
    subjectUserId: "user-1",
    subjectLabel: "玩家甲",
    storedStatus: "active",
    resolvedStatus: "active",
    effects: ["registration_block"],
    internalEvidence: "私密证据：聊天记录截图",
    publicExplanation: " public 说明",
    effectiveFrom: "2026-08-01T00:00:00.000Z",
    effectiveUntil: null,
    revokedAt: null,
    revocationReason: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

async function searchAndPickSubject() {
  fireEvent.change(screen.getByLabelText(/搜索被处罚用户/), { target: { value: "玩家乙" } });
  await waitFor(() => expect(screen.getByRole("option", { name: /玩家乙/ })).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText("选择被处罚用户"), { target: { value: "user-2" } });
}

describe("DisciplineManagement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    issueSanctionMock.mockResolvedValue({ success: true, data: { caseId: "new-case" } });
    revokeSanctionMock.mockResolvedValue({ success: true, data: { alreadyRevoked: false, caseId: "case-1" } });
    expireSanctionMock.mockResolvedValue({ success: true, data: { alreadyExpired: false, caseId: "case-1" } });
    searchSanctionSubjectsMock.mockResolvedValue({
      success: true,
      data: [{ id: "user-2", label: "玩家乙", detail: "b@example.test" }],
    });
  });

  it("shows resolved status, effects, window and admin-only internal evidence", () => {
    render(
      <DisciplineManagement seasonId="season-1" sanctions={[row()]} />,
    );

    expect(screen.getByText("生效中", { selector: "[data-status]" })).toBeInTheDocument();
    // 效果 chip + 签发表单中的复选框标签
    expect(screen.getAllByText("报名拦截")).toHaveLength(2);
    expect(screen.getByText(/生效窗口：/)).toBeInTheDocument();
    expect(screen.getByText(/私密证据：聊天记录截图/)).toBeInTheDocument();
  });

  it("renders the empty state when the season has no sanctions", () => {
    render(<DisciplineManagement seasonId="season-1" sanctions={[]} />);
    expect(screen.getByText("本赛事暂无纪律处罚记录")).toBeInTheDocument();
  });

  it("filters the list by resolved status", () => {
    render(
      <DisciplineManagement
        seasonId="season-1"
        sanctions={[row(), row({ id: "case-2", subjectLabel: "玩家乙", resolvedStatus: "revoked", storedStatus: "revoked", revocationReason: "误判" })]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "已撤销" }));
    expect(screen.getByText("玩家乙")).toBeInTheDocument();
    expect(screen.queryByText("玩家甲")).not.toBeInTheDocument();
    expect(screen.getByText("撤销原因：误判")).toBeInTheDocument();
  });

  it("does not search until the query reaches the minimum length", async () => {
    render(<DisciplineManagement seasonId="season-1" sanctions={[]} />);

    fireEvent.change(screen.getByLabelText(/搜索被处罚用户/), { target: { value: "甲" } });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(searchSanctionSubjectsMock).not.toHaveBeenCalled();
    expect(screen.getByRole("option", { name: "— 选择用户 —" })).toBeInTheDocument();
  });

  it("searches subjects on demand and surfaces search errors", async () => {
    render(<DisciplineManagement seasonId="season-1" sanctions={[]} />);

    fireEvent.change(screen.getByLabelText(/搜索被处罚用户/), { target: { value: "玩家乙" } });
    await waitFor(() => expect(searchSanctionSubjectsMock).toHaveBeenCalledWith({ seasonId: "season-1", query: "玩家乙" }));
    await waitFor(() => expect(screen.getByRole("option", { name: /玩家乙/ })).toBeInTheDocument());

    searchSanctionSubjectsMock.mockResolvedValue({
      success: false,
      error: { code: "FORBIDDEN", message: "没有权限执行该操作。" },
    });
    fireEvent.change(screen.getByLabelText(/搜索被处罚用户/), { target: { value: "别人" } });
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("没有权限执行该操作。"));
  });

  it("blocks issuing without subject or effect selection and does not call the action", () => {
    render(<DisciplineManagement seasonId="season-1" sanctions={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "签发处罚" }));
    expect(screen.getByRole("alert")).toHaveTextContent("请先搜索并选择被处罚用户。");
    expect(issueSanctionMock).not.toHaveBeenCalled();
  });

  it("issues a sanction with the searched subject, effects and open-ended window", async () => {
    render(<DisciplineManagement seasonId="season-1" sanctions={[]} />);

    await searchAndPickSubject();
    fireEvent.click(screen.getByRole("checkbox", { name: "参赛拦截" }));
    fireEvent.change(screen.getByLabelText(/内部证据/), { target: { value: "证据 A" } });
    fireEvent.change(screen.getByLabelText(/公开说明/), { target: { value: "说明 B" } });
    fireEvent.click(screen.getByRole("button", { name: "签发处罚" }));

    await waitFor(() => expect(issueSanctionMock).toHaveBeenCalledTimes(1));
    expect(issueSanctionMock).toHaveBeenCalledWith({
      seasonId: "season-1",
      subjectUserId: "user-2",
      effects: ["match_participation_block"],
      internalEvidence: "证据 A",
      publicExplanation: "说明 B",
      effectiveUntil: null,
    });
  });

  it("blocks revocation without a reason and does not call the action", () => {
    render(<DisciplineManagement seasonId="season-1" sanctions={[row()]} />);

    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    const confirmButton = screen.getByRole("button", { name: "确认撤销" });
    expect(confirmButton).toBeDisabled();
    fireEvent.click(confirmButton);
    expect(revokeSanctionMock).not.toHaveBeenCalled();
  });

  it("revokes a sanction through the inline reason form", async () => {
    render(<DisciplineManagement seasonId="season-1" sanctions={[row()]} />);

    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    fireEvent.change(screen.getByLabelText(/撤销原因/), { target: { value: "证据不足" } });
    fireEvent.click(screen.getByRole("button", { name: "确认撤销" }));

    await waitFor(() => expect(revokeSanctionMock).toHaveBeenCalledWith({ caseId: "case-1", reason: "证据不足" }));
    expect(refreshMock).toHaveBeenCalled();
  });

  it("offers explicit expire only for stored-active rows whose window has passed", async () => {
    render(
      <DisciplineManagement
        seasonId="season-1"
        sanctions={[
          row({ id: "case-stale", resolvedStatus: "expired", effectiveUntil: "2026-08-02T00:00:00.000Z" }),
          row({ id: "case-live" }),
          row({ id: "case-expired", storedStatus: "expired", resolvedStatus: "expired" }),
        ]}
      />,
    );

    const expireButtons = screen.getAllByRole("button", { name: "标记过期" });
    expect(expireButtons).toHaveLength(1);

    fireEvent.click(expireButtons[0]);
    await waitFor(() => expect(expireSanctionMock).toHaveBeenCalledWith({ caseId: "case-stale" }));
  });

  it("surfaces action errors inline", async () => {
    revokeSanctionMock.mockResolvedValue({ success: false, error: { code: "FORBIDDEN", message: "没有权限执行该操作。" } });
    render(<DisciplineManagement seasonId="season-1" sanctions={[row()]} />);

    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    fireEvent.change(screen.getByLabelText(/撤销原因/), { target: { value: "误操作" } });
    fireEvent.click(screen.getByRole("button", { name: "确认撤销" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("没有权限执行该操作。"));
  });
});
