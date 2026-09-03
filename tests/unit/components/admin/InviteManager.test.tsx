/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInviteCode, deactivateInviteCode } from "@/actions/admin";
import { InviteManager } from "@/components/admin/InviteManager";

const { toastErrorMock, toastSuccessMock } = vi.hoisted(() => ({
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: toastErrorMock, success: toastSuccessMock },
}));

vi.mock("@/actions/admin", () => ({
  createInviteCode: vi.fn(),
  deactivateInviteCode: vi.fn(),
}));

const createInviteCodeMock = vi.mocked(createInviteCode);
const deactivateInviteCodeMock = vi.mocked(deactivateInviteCode);

const seasons = [{ id: "season-1", name: "春季赛", slug: "spring" }];

function renderInviteManager() {
  return render(<InviteManager invites={[]} seasons={seasons} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  createInviteCodeMock.mockResolvedValue({
    success: true,
    data: {
      id: "invite-1",
      code: "invite-code",
      role: "season_admin",
      seasonId: "season-1",
      maxUses: 1,
      expiresAt: null,
    },
  });
  deactivateInviteCodeMock.mockResolvedValue({ success: true, data: undefined });
});

describe("InviteManager", () => {
  it("defaults to season_admin and creates it directly without confirmation", async () => {
    const user = userEvent.setup();
    renderInviteManager();

    expect(screen.getByLabelText("角色")).toHaveValue("season_admin");
    await user.click(screen.getByRole("button", { name: "生成邀请码" }));

    await waitFor(() =>
      expect(createInviteCodeMock).toHaveBeenCalledWith({
        role: "season_admin",
        seasonId: "season-1",
        maxUses: 1,
        expiresInHours: undefined,
      }),
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("shows a global high-privilege warning when super_admin is selected", async () => {
    const user = userEvent.setup();
    renderInviteManager();

    await user.selectOptions(screen.getByLabelText("角色"), "super_admin");

    expect(screen.getByRole("alert")).toHaveTextContent(
      "超级管理员拥有跨赛事管理、教育认证审核及全局管理能力",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "日常赛务请使用“赛季管理员”",
    );
  });

  it("confirms super_admin with the current use count and expiry before creating", async () => {
    const user = userEvent.setup();
    renderInviteManager();

    await user.selectOptions(screen.getByLabelText("角色"), "super_admin");
    await user.clear(screen.getByLabelText("次数"));
    await user.type(screen.getByLabelText("次数"), "3");
    await user.type(screen.getByLabelText("有效期（小时）"), "48");
    await user.click(screen.getByRole("button", { name: "生成邀请码" }));

    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("超级管理员");
    expect(dialog).toHaveTextContent("跨赛事全局（不绑定单一赛事）");
    expect(dialog).toHaveTextContent("3 次");
    expect(dialog).toHaveTextContent("48 小时（从生成时起算）");
    expect(createInviteCodeMock).not.toHaveBeenCalled();

    await user.click(
      within(dialog).getByRole("button", { name: "确认生成超级管理员邀请码" }),
    );

    await waitFor(() =>
      expect(createInviteCodeMock).toHaveBeenCalledWith({
        role: "super_admin",
        maxUses: 3,
        expiresInHours: 48,
      }),
    );
  });

  it("shows the permanent validity text and does not call the action when cancelled", async () => {
    const user = userEvent.setup();
    renderInviteManager();

    await user.selectOptions(screen.getByLabelText("角色"), "super_admin");
    await user.click(screen.getByRole("button", { name: "生成邀请码" }));

    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("永久有效，直到撤销或用尽");

    await user.click(within(dialog).getByRole("button", { name: "取消" }));

    expect(createInviteCodeMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
