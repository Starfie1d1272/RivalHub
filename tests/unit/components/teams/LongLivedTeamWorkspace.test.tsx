/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LongLivedTeamWorkspace } from "@/components/teams/LongLivedTeamWorkspace";

const { createTeamMock, refreshMock } = vi.hoisted(() => ({
  createTeamMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useTransition: () => [false, (work: () => void) => void work()] };
});

vi.mock("@/actions/teams", () => ({
  acceptTeamInvitation: vi.fn(),
  createTeam: createTeamMock,
  createTeamShareInvitation: vi.fn(),
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

  it("passes the existing logo and captain edit capability into the profile section", () => {
    render(<LongLivedTeamWorkspace currentUserId="user-1" team={{ id: "team-1", slug: "rival-team", name: "Rival Team", logoUrl: "https://example.com/logo.png", description: null, captainUserId: "user-1" }} memberships={[]} incomingInvitations={[]} outgoingInvitations={[]} recruitment={null} targetSeasons={[]} recruitmentInterests={[]} />);

    expect(screen.getByRole("button", { name: "更换队伍图标" })).toBeInTheDocument();
  });
});
