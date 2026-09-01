/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClaimTeamInviteButton } from "@/components/register/ClaimTeamInviteButton";

const { acceptTeamInvitationMock, pushMock, successMock } = vi.hoisted(() => ({
  acceptTeamInvitationMock: vi.fn(),
  pushMock: vi.fn(),
  successMock: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useTransition: () => [false, (work: () => void) => void work()] };
});
vi.mock("@/actions/teams", () => ({ acceptTeamInvitation: acceptTeamInvitationMock }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock, refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: successMock, error: vi.fn() } }));

describe("ClaimTeamInviteButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    acceptTeamInvitationMock.mockResolvedValue({ success: true, data: { slug: "rival-team", teamId: "team-1" } });
  });

  it("uses ordinary Team copy for the action and toast", async () => {
    render(<ClaimTeamInviteButton token={"a".repeat(32)} />);

    expect(screen.getByRole("button", { name: "加入队伍" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "加入队伍" }));

    await waitFor(() => {
      expect(acceptTeamInvitationMock).toHaveBeenCalledWith({ token: "a".repeat(32) });
      expect(successMock).toHaveBeenCalledWith("已加入队伍");
      expect(pushMock).toHaveBeenCalledWith("/teams/rival-team");
    });
    expect(screen.queryByText(/长期 Team/)).not.toBeInTheDocument();
  });
});
