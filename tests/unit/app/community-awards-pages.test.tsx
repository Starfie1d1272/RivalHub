/**
 * @vitest-environment jsdom
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  adminSeasonFindFirstMock,
  adminDataMock,
  getCurrentUserAuthorizationMock,
  getPublicSeasonMock,
  notFoundMock,
  publicDataMock,
  requireSeasonAdminMock,
} = vi.hoisted(() => ({
  adminSeasonFindFirstMock: vi.fn(),
  adminDataMock: vi.fn(),
  getCurrentUserAuthorizationMock: vi.fn(),
  getPublicSeasonMock: vi.fn(),
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  publicDataMock: vi.fn(),
  requireSeasonAdminMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({ notFound: notFoundMock }));
vi.mock("@/db/client", () => ({
  db: { query: { seasons: { findFirst: adminSeasonFindFirstMock } } },
}));
vi.mock("@/lib/auth/session", () => ({
  getCurrentUserAuthorization: getCurrentUserAuthorizationMock,
  requireSeasonAdmin: requireSeasonAdminMock,
}));
vi.mock("@/lib/data/public-seasons", () => ({
  getPublicOrAuthorizedDraftSeason: getPublicSeasonMock,
}));
vi.mock("@/lib/community-awards/data", () => ({
  getAdminCommunityAwardBoardData: adminDataMock,
  getPublicCommunityAwardBoardData: publicDataMock,
}));
vi.mock("@/components/community-awards/CommunityAwardsBoard", () => ({
  CommunityAwardsBoard: () => <div data-testid="community-awards-board" />,
}));

import PublicCommunityAwardsPage from "@/app/[seasonSlug]/community-awards/page";
import AdminCommunityAwardsPage from "@/app/admin/[seasonSlug]/community-awards/page";

const publicSeason = {
  id: "season-1",
  slug: "season-1",
  name: "Season 1",
  status: "playing",
  hasCommunityAwards: true,
  stagePlan: [],
};

describe("community awards route capability guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("React", React);
    getCurrentUserAuthorizationMock.mockResolvedValue(null);
    requireSeasonAdminMock.mockResolvedValue({ userId: "admin-1", role: "super_admin" });
    adminDataMock.mockResolvedValue({ awards: [], candidates: [], matches: [] });
    publicDataMock.mockResolvedValue({ awards: [], candidates: [], matches: [] });
  });

  it("404s the public route before loading community-awards data when disabled", async () => {
    getPublicSeasonMock.mockResolvedValue({ ...publicSeason, hasCommunityAwards: false });

    await expect(PublicCommunityAwardsPage({ params: Promise.resolve({ seasonSlug: "season-1" }) })).rejects.toThrow("NEXT_NOT_FOUND");

    expect(notFoundMock).toHaveBeenCalled();
  });

  it("404s the admin route before authorizing or loading data when disabled", async () => {
    adminSeasonFindFirstMock.mockResolvedValue({ ...publicSeason, hasCommunityAwards: false });

    await expect(AdminCommunityAwardsPage({ params: Promise.resolve({ seasonSlug: "season-1" }) })).rejects.toThrow("NEXT_NOT_FOUND");

    expect(notFoundMock).toHaveBeenCalled();
    expect(requireSeasonAdminMock).not.toHaveBeenCalled();
    expect(adminDataMock).not.toHaveBeenCalled();
  });

  it("keeps the public route available when enabled", async () => {
    getPublicSeasonMock.mockResolvedValue(publicSeason);

    const page = await PublicCommunityAwardsPage({ params: Promise.resolve({ seasonSlug: "season-1" }) });

    expect(renderToStaticMarkup(page)).toContain("社区奖 · Season 1");
  });
});
