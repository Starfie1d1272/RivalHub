/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { claimTeamApplicationJoinLink } from "@/actions/team-applications";
import { ClaimTeamInviteButton } from "@/components/register/ClaimTeamInviteButton";

const push = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/actions/team-applications", () => ({
  claimTeamApplicationJoinLink: vi.fn(),
}));

const claimMock = vi.mocked(claimTeamApplicationJoinLink);

describe("ClaimTeamInviteButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("claims the link and returns the participant to the team application", async () => {
    const user = userEvent.setup();
    claimMock.mockResolvedValue({ success: true, data: { seasonSlug: "nju-major", applicationId: "application-1", alreadyMember: false } });
    render(<ClaimTeamInviteButton token="invite-token" />);

    await user.click(screen.getByRole("button", { name: "加入报名队伍" }));

    await waitFor(() => expect(claimMock).toHaveBeenCalledWith("invite-token"));
    expect(push).toHaveBeenCalledWith("/nju-major/register");
    expect(refresh).toHaveBeenCalledOnce();
  });
});
