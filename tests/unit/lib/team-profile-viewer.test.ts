import { beforeEach, describe, expect, it, vi } from "vitest";

const interest = vi.hoisted(() => vi.fn());
const invitation = vi.hoisted(() => vi.fn());
vi.mock("@/db/client", () => ({ db: { query: { recruitmentInterests: { findFirst: interest }, teamInvitations: { findFirst: invitation } } } }));
vi.mock("@/lib/recruitment/data", () => ({ getPublicTeamRecruitment: vi.fn() }));

import { getTeamProfileViewerState, type PublicTeamProfileCore } from "@/lib/teams/public-profile";

const core = {
  team: { id: "team-1" },
  currentMembers: [{ userId: "member", status: "active" }],
  recruitment: { id: "recruitment-1" },
} as PublicTeamProfileCore;

describe("team viewer state", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not query personal state for an anonymous viewer", async () => {
    expect(await getTeamProfileViewerState(core)).toEqual({ currentUserMembership: null, viewerInterested: false, viewerInvited: false, loggedIn: false });
    expect(interest).not.toHaveBeenCalled();
    expect(invitation).not.toHaveBeenCalled();
  });

  it("loads each viewer separately without adding private flags to the reusable core", async () => {
    const original = JSON.stringify(core);
    interest.mockResolvedValueOnce({ id: "interest-1" }).mockResolvedValueOnce(null);
    invitation.mockResolvedValueOnce({ id: "invitation-1" }).mockResolvedValueOnce(null);

    expect(await getTeamProfileViewerState(core, "viewer-1")).toMatchObject({ viewerInterested: true, viewerInvited: true });
    expect(await getTeamProfileViewerState(core, "viewer-2")).toMatchObject({ viewerInterested: false, viewerInvited: false });
    expect(JSON.stringify(core)).toBe(original);
    expect(interest).toHaveBeenCalledTimes(2);
    expect(invitation).toHaveBeenCalledTimes(2);
  });
});
