/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LongLivedTeamWorkspace } from "@/components/teams/LongLivedTeamWorkspace";

const { createTeamMock, createShareInvitationMock, refreshMock } = vi.hoisted(() => ({
  createTeamMock: vi.fn(),
  createShareInvitationMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useTransition: () => [false, (work: () => void) => void work()] };
});

vi.mock("@/actions/teams", () => ({
  acceptTeamInvitation: vi.fn(),
  createTeam: createTeamMock,
  createTeamShareInvitation: createShareInvitationMock,
  declineTeamInvitation: vi.fn(),
  disbandTeam: vi.fn(),
  inviteTeamMember: vi.fn(),
  kickTeamMember: vi.fn(),
  leaveTeam: vi.fn(),
  revokeTeamInvitation: vi.fn(),
  setTeamMembershipStatus: vi.fn(),
  transferTeamCaptain: vi.fn(),
  updateTeamProfile: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe("LongLivedTeamWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createTeamMock.mockResolvedValue({ success: true, data: { teamId: "team-1", slug: "rival-team" } });
    createShareInvitationMock.mockResolvedValue({ success: true, data: { token: "a".repeat(32), expiresAt: "2026-09-10T07:00:00.000Z" } });
  });

  it("keeps the create action contract behind the anchored create section", async () => {
    render(<LongLivedTeamWorkspace currentUserId="user-1" team={null} memberships={[]} incomingInvitations={[]} outgoingInvitations={[]} recruitment={null} targetSeasons={[]} recruitmentInterests={[]} />);

    expect(document.getElementById("create-team")).toHaveClass("scroll-mt-24");
    expect(screen.getByText("创建你的队伍")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("队伍名称"), { target: { value: "新队伍" } });
    fireEvent.change(screen.getByLabelText("简介"), { target: { value: "队伍简介" } });
    fireEvent.click(screen.getByRole("button", { name: "创建队伍" }));

    await waitFor(() => expect(createTeamMock).toHaveBeenCalledWith({ name: "新队伍", description: "队伍简介" }));
  });

  it("keeps incoming invitations before the create section for users without a Team", () => {
    render(<LongLivedTeamWorkspace currentUserId="user-1" team={null} memberships={[]} incomingInvitations={[{ id: "invitation-1", teamId: "team-2", teamName: "受邀队伍", expiresAt: "2026-09-10T07:00:00.000Z" }]} outgoingInvitations={[]} recruitment={null} targetSeasons={[]} recruitmentInterests={[]} />);

    const invitationSection = document.getElementById("team-invitations");
    const createSection = document.getElementById("create-team");
    expect(invitationSection).toBeInTheDocument();
    expect(createSection).toBeInTheDocument();
    expect(invitationSection?.compareDocumentPosition(createSection!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByText("接受邀请即加入队伍，不需要再次申请或等待队长审核。")).toBeInTheDocument();
    expect(screen.getByText("受邀队伍")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "接受" })).toBeInTheDocument();
  });

  it("shows the single-use share-link contract and expiry after generation", async () => {
    render(<LongLivedTeamWorkspace currentUserId="user-1" team={{ id: "team-1", slug: "rival-team", name: "Rival Team", logoUrl: null, description: null, captainUserId: "user-1" }} memberships={[]} incomingInvitations={[]} outgoingInvitations={[]} recruitment={null} targetSeasons={[]} recruitmentInterests={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "生成单次邀请链接" }));

    await waitFor(() => expect(createShareInvitationMock).toHaveBeenCalledWith({ teamId: "team-1" }));
    expect(screen.getByText("单次邀请链接 · 7 天有效")).toBeInTheDocument();
    expect(screen.getByText("到期时间：2026/09/10 15:00。")).toBeInTheDocument();
    expect(screen.getByText("接受一次后失效；可由队长撤销。")).toBeInTheDocument();
    expect((screen.getByRole("textbox", { name: "单次邀请链接" }) as HTMLInputElement).value).toContain("/team-invites/");
  });

  it("passes the existing logo and captain edit capability into the profile section", () => {
    render(<LongLivedTeamWorkspace currentUserId="user-1" team={{ id: "team-1", slug: "rival-team", name: "Rival Team", logoUrl: "https://example.com/logo.png", description: null, captainUserId: "user-1" }} memberships={[]} incomingInvitations={[]} outgoingInvitations={[]} recruitment={null} targetSeasons={[]} recruitmentInterests={[]} />);

    expect(screen.getByRole("button", { name: "更换队伍图标" })).toBeInTheDocument();
  });
});
