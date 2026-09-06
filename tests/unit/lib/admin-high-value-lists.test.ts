import { describe, expect, it } from "vitest";
import { normalizeAdminInviteQuery, resolveAdminInviteState } from "@/lib/admin/invites";
import { normalizeAdminUsersQuery } from "@/lib/admin/users";
import { normalizeDisciplineAdminQuery } from "@/lib/discipline/admin-review";
import {
  normalizeSoloRegistrationReviewQuery,
  normalizeTeamRegistrationReviewQuery,
} from "@/lib/registrations/admin-review";

describe("PR3 admin list query contracts", () => {
  it("normalizes team and solo registration filters without trusting URL values", () => {
    expect(normalizeTeamRegistrationReviewQuery(new URLSearchParams({
      q: "  Team Alpha  ",
      status: "all",
      qualification: "blocked",
      sort: "newest_updated",
      page: "3",
    }))).toEqual({
      q: "Team Alpha",
      status: "all",
      qualification: "blocked",
      sort: "newest_updated",
      page: 3,
      pageSize: 25,
    });
    expect(normalizeSoloRegistrationReviewQuery(new URLSearchParams({
      status: "invalid",
      position: "awper",
      sort: "recent",
      page: "0",
    }), ["rifler", "awper"])).toMatchObject({
      status: "pending",
      position: "awper",
      sort: "oldest",
      page: 1,
      pageSize: 25,
    });
    expect(normalizeSoloRegistrationReviewQuery(new URLSearchParams({ position: "awper" }), ["rifler"])).toMatchObject({
      position: undefined,
    });
  });

  it("normalizes invite, discipline, and user list filters to bounded values", () => {
    expect(normalizeAdminInviteQuery(new URLSearchParams({
      role: "unknown",
      state: "unknown",
      season: "not-a-uuid",
      sort: "unknown",
      page: "-1",
    }))).toEqual({
      role: "all",
      state: "all",
      season: undefined,
      sort: "newest",
      page: 1,
      pageSize: 25,
    });
    expect(normalizeDisciplineAdminQuery(new URLSearchParams({
      q: "  player@example.test ",
      status: "revoked",
      sort: "oldest",
      page: "2",
    }))).toEqual({
      q: "player@example.test",
      status: "revoked",
      sort: "newest",
      page: 2,
      pageSize: 25,
    });
    expect(normalizeAdminUsersQuery(new URLSearchParams({
      q: "  player  ",
      filter: "participated",
      page: "4",
    }))).toEqual({
      q: "player",
      filter: "participated",
      page: 4,
      pageSize: 50,
    });
  });

  it("resolves invite state with revoked, expired, and exhausted precedence", () => {
    const now = new Date("2026-09-06T00:00:00.000Z");
    expect(resolveAdminInviteState({ isActive: false, expiresAt: now, maxUses: 1, claimCount: 1 }, now)).toBe("revoked");
    expect(resolveAdminInviteState({ isActive: true, expiresAt: now, maxUses: 1, claimCount: 1 }, now)).toBe("expired");
    expect(resolveAdminInviteState({ isActive: true, expiresAt: null, maxUses: 1, claimCount: 1 }, now)).toBe("exhausted");
    expect(resolveAdminInviteState({ isActive: true, expiresAt: null, maxUses: 2, claimCount: 1 }, now)).toBe("usable");
  });
});
