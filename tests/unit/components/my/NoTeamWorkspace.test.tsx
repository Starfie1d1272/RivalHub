/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NoTeamWorkspace } from "@/components/my/NoTeamWorkspace";

const { createTeamMock, acceptMock, declineMock, refreshMock } = vi.hoisted(() => ({
  createTeamMock: vi.fn(),
  acceptMock: vi.fn(),
  declineMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useTransition: () => [false, (work: () => void) => void work()] };
});
vi.mock("@/actions/teams", () => ({ createTeam: createTeamMock, acceptTeamInvitation: acceptMock, declineTeamInvitation: declineMock }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe("NoTeamWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createTeamMock.mockResolvedValue({ success: true, data: { teamId: "team-1", slug: "new-team" } });
    acceptMock.mockResolvedValue({ success: true, data: { teamId: "team-2", slug: "invited-team" } });
    declineMock.mockResolvedValue({ success: true, data: undefined });
  });

  it("puts pending invitations before the anchored create flow", () => {
    render(<NoTeamWorkspace pendingInvitations={[{ id: "invitation-1", teamId: "team-2", teamName: "受邀队伍", expiresAt: "2026-09-10T07:00:00.000Z" }]} />);
    const invitationSection = document.getElementById("team-invitations");
    const createSection = document.getElementById("create-team");
    expect(invitationSection).toBeInTheDocument();
    expect(createSection).toBeInTheDocument();
    expect(invitationSection?.compareDocumentPosition(createSection!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByText("接受邀请即加入队伍，不需要再次申请或等待队长审核。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "接受" })).toBeInTheDocument();
  });

  it("keeps creation and lobby actions in the no-Team client island", async () => {
    render(<NoTeamWorkspace pendingInvitations={[]} />);
    fireEvent.change(screen.getByLabelText("队伍名称"), { target: { value: "新队伍" } });
    fireEvent.change(screen.getByLabelText("简介"), { target: { value: "队伍简介" } });
    fireEvent.click(screen.getByRole("button", { name: "创建队伍" }));
    await waitFor(() => expect(createTeamMock).toHaveBeenCalledWith({ name: "新队伍", description: "队伍简介" }));
    expect(screen.getByRole("link", { name: "去组队大厅" })).toHaveAttribute("href", "/teams/recruitment?view=teams");
  });
});
