import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatCSTShortDate } from "@/lib/utils/date";

const { getRecruitmentLobbyDataMock, getUserSessionMock } = vi.hoisted(() => ({
  getRecruitmentLobbyDataMock: vi.fn(),
  getUserSessionMock: vi.fn(),
}));

vi.mock("next/image", () => ({ default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => React.createElement("img", props) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("@/lib/auth/session", () => ({ getUserSession: getUserSessionMock }));
vi.mock("@/lib/recruitment/data", () => ({
  getPublicPlayerLft: vi.fn(),
  getRecruitmentLobbyData: getRecruitmentLobbyDataMock,
}));

import RecruitmentLobbyPage from "@/app/teams/recruitment/page";

const updatedAt = new Date("2026-09-01T16:00:00.000Z");
const basePlayer = { id: "player-intent", positions: ["awper"], targetSeasonId: null, targetSeasonName: null, note: null, expiresAt: new Date("2026-09-30T00:00:00.000Z"), updatedAt, userId: "player-1", name: "选手", avatarUrl: null, currentTeamId: null, currentTeamName: null, competitiveRoles: ["awper"], mapPreferences: [], competitiveSummary: [] };
const baseLobbyData = {
  teamRecruitments: [{ id: "team-intent", positions: [], targetSeasonId: null, targetSeasonName: null, note: null, expiresAt: new Date("2026-09-30T00:00:00.000Z"), updatedAt, teamId: "team-1", teamSlug: "rival-team", teamName: "Rival Team", logoUrl: null, captainName: "队长", memberCount: 4 }],
  playerLfts: [basePlayer],
  targetSeasons: [],
  viewerInterestedIntentIds: new Set<string>(),
};

describe("recruitment lobby cards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("React", React);
    getUserSessionMock.mockResolvedValue(null);
    getRecruitmentLobbyDataMock.mockResolvedValue(baseLobbyData);
  });

  it.each(["teams", "players"] as const)("renders the %s card update date", async (view) => {
    const page = await RecruitmentLobbyPage({ searchParams: Promise.resolve({ view }) });
    const html = renderToStaticMarkup(page);

    expect(html).toContain(`最近更新 · ${formatCSTShortDate(updatedAt)}`);
  });

  it("renders a real avatar when the public DTO provides one", async () => {
    getRecruitmentLobbyDataMock.mockResolvedValueOnce({
      ...baseLobbyData,
      playerLfts: [{ ...basePlayer, avatarUrl: "https://cdn.example/avatar.png" }],
    });
    const page = await RecruitmentLobbyPage({ searchParams: Promise.resolve({ view: "players" }) });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("<img");
    expect(html).toContain('src="https://cdn.example/avatar.png"');
    expect(html).toContain('alt="选手"');
  });

  it("keeps the initials fallback when no avatar is available", async () => {
    getRecruitmentLobbyDataMock.mockResolvedValueOnce({
      ...baseLobbyData,
      playerLfts: [{ ...basePlayer, name: "Player One", avatarUrl: null }],
    });
    const page = await RecruitmentLobbyPage({ searchParams: Promise.resolve({ view: "players" }) });
    const html = renderToStaticMarkup(page);

    expect(html).not.toContain("<img");
    expect(html).toContain(">PL</div>");
  });

  it("renders compact competitive summaries in canonical platform order", async () => {
    getRecruitmentLobbyDataMock.mockResolvedValueOnce({
      ...baseLobbyData,
      playerLfts: [{
        ...basePlayer,
        competitiveSummary: [
          {
            displayName: "完美世界竞技平台",
            facts: [
              { label: "历史最高", rankLabel: "黄金 S", stars: 10, ratingLabel: "Rating Pro", rating: "1.17" },
              { label: "2026 第二赛季", rankLabel: "未定级", stars: null, ratingLabel: null, rating: null },
            ],
          },
          {
            displayName: "5E",
            facts: [{ label: "2026 第二赛季 · 最高", rankLabel: "SS", stars: 20, ratingLabel: "Rating+", rating: "1800" }],
          },
        ],
      }],
    });
    const page = await RecruitmentLobbyPage({ searchParams: Promise.resolve({ view: "players" }) });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("完美世界竞技平台");
    expect(html).toContain("黄金 S");
    expect(html).toContain("10★");
    expect(html).toContain("Rating Pro 1.17");
    expect(html).toContain("5E");
    expect(html).toContain("未定级");
    expect(html.indexOf("完美世界竞技平台")).toBeLessThan(html.indexOf("5E"));
  });

  it("renders map proficiency when provided and an explicit unfilled state otherwise", async () => {
    getRecruitmentLobbyDataMock.mockResolvedValueOnce({
      ...baseLobbyData,
      playerLfts: [{ ...basePlayer, targetSeasonId: "season-1", targetSeasonName: "目标赛事", mapPreferenceContextLabel: "目标赛事图池熟练度", mapPreferences: [{ map: "de_cache", level: null }, { map: "de_mirage", level: "strong" }] }],
    });
    const page = await RecruitmentLobbyPage({ searchParams: Promise.resolve({ view: "players" }) });
    const html = renderToStaticMarkup(page);
    expect(html).toContain("目标赛事图池熟练度");
    expect(html).toContain("Mirage");
    expect(html).toContain("未填写 1 张");

    getRecruitmentLobbyDataMock.mockResolvedValueOnce({ ...baseLobbyData, playerLfts: [{ ...basePlayer, mapPreferences: [] }] });
    const emptyPage = await RecruitmentLobbyPage({ searchParams: Promise.resolve({ view: "players" }) });
    const emptyHtml = renderToStaticMarkup(emptyPage);
    expect(emptyHtml).toContain("未填写地图熟练度");
  });
});
