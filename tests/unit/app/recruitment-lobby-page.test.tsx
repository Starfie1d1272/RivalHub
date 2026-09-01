import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatCSTShortDate } from "@/lib/utils/date";

const { getRecruitmentLobbyDataMock, getUserSessionMock } = vi.hoisted(() => ({
  getRecruitmentLobbyDataMock: vi.fn(),
  getUserSessionMock: vi.fn(),
}));

vi.mock("next/image", () => ({ default: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("@/lib/auth/session", () => ({ getUserSession: getUserSessionMock }));
vi.mock("@/lib/recruitment/data", () => ({
  getPublicPlayerLft: vi.fn(),
  getRecruitmentLobbyData: getRecruitmentLobbyDataMock,
}));

import RecruitmentLobbyPage from "@/app/teams/recruitment/page";

const updatedAt = new Date("2026-09-01T16:00:00.000Z");

describe("recruitment lobby cards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("React", React);
    getUserSessionMock.mockResolvedValue(null);
    getRecruitmentLobbyDataMock.mockResolvedValue({
      teamRecruitments: [{ id: "team-intent", positions: [], targetSeasonId: null, targetSeasonName: null, note: null, expiresAt: new Date("2026-09-30T00:00:00.000Z"), updatedAt, teamId: "team-1", teamSlug: "rival-team", teamName: "Rival Team", logoUrl: null, captainName: "队长", memberCount: 4 }],
      playerLfts: [{ id: "player-intent", positions: ["awper"], targetSeasonId: null, targetSeasonName: null, note: null, expiresAt: new Date("2026-09-30T00:00:00.000Z"), updatedAt, userId: "player-1", name: "选手", avatarUrl: null, currentTeamId: null, currentTeamName: null, competitiveRoles: ["awper"] }],
      targetSeasons: [],
      viewerInterestedIntentIds: new Set(),
    });
  });

  it.each(["teams", "players"] as const)("renders the %s card update date", async (view) => {
    const page = await RecruitmentLobbyPage({ searchParams: Promise.resolve({ view }) });
    const html = renderToStaticMarkup(page);

    expect(html).toContain(`最近更新 · ${formatCSTShortDate(updatedAt)}`);
  });
});
