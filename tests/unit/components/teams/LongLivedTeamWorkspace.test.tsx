/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LongLivedTeamWorkspace } from "@/components/teams/LongLivedTeamWorkspace";

const { createShareInvitationMock, refreshMock } = vi.hoisted(() => ({
  createShareInvitationMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useTransition: () => [false, (work: () => void) => void work()] };
});

vi.mock("@/actions/teams", () => ({
  acceptTeamInvitation: vi.fn(),
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
    createShareInvitationMock.mockResolvedValue({ success: true, data: { token: "a".repeat(32), expiresAt: "2026-09-10T07:00:00.000Z" } });
  });

  it("shows the single-use share-link contract and expiry after generation", async () => {
    render(<LongLivedTeamWorkspace team={{ id: "team-1", slug: "rival-team", name: "Rival Team", logoUrl: null, description: null, captainUserId: "user-1" }} memberships={[]} incomingInvitations={[]} outgoingInvitations={[]} recruitment={null} targetSeasons={[]} recruitmentInterests={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "生成单次邀请链接" }));

    await waitFor(() => expect(createShareInvitationMock).toHaveBeenCalledWith({ teamId: "team-1" }));
    expect(screen.getByText("单次邀请链接 · 7 天有效")).toBeInTheDocument();
    expect(screen.getByText("到期时间：2026/09/10 15:00。")).toBeInTheDocument();
    expect(screen.getByText("接受一次后失效；可由队长撤销。")).toBeInTheDocument();
    expect((screen.getByRole("textbox", { name: "单次邀请链接" }) as HTMLInputElement).value).toContain("/team-invites/");
  });

  it("passes the existing logo and captain edit capability into the profile section", () => {
    render(<LongLivedTeamWorkspace team={{ id: "team-1", slug: "rival-team", name: "Rival Team", logoUrl: "https://example.com/logo.png", description: null, captainUserId: "user-1" }} memberships={[]} incomingInvitations={[]} outgoingInvitations={[]} recruitment={null} targetSeasons={[]} recruitmentInterests={[]} />);

    expect(screen.getByRole("button", { name: "更换队伍图标" })).toBeInTheDocument();
  });
});
