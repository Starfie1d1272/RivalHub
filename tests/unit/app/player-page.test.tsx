import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { profileReadModelMock, canonicalUserMock } = vi.hoisted(() => ({
  profileReadModelMock: vi.fn(),
  canonicalUserMock: vi.fn(),
}));

vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("@/lib/identity/canonical", () => ({ resolveCanonicalUserId: canonicalUserMock }));
vi.mock("@/lib/players/public-profile", () => ({ getPublicPlayerProfileReadModel: profileReadModelMock }));
vi.mock("@/components/stats/players/PlayerWorkspace", () => ({ PlayerWorkspace: () => <div>Shared player metrics</div> }));
vi.mock("@/components/players/PlayerPerformanceFilters", () => ({ PlayerPerformanceFilters: () => <div>Event and map filters</div> }));

import { PlayerPageContent } from "@/app/players/[userId]/page";

function profile() {
  return {
    user: {
      id: "user-1",
      displayName: "玩家甲",
      perfectName: null,
      personaName: null,
      steamProfileUrl: null,
      avatarUrl: null,
      gameplayStyle: "当前偏稳健控图",
      competitionHistory: "参加过 NJU Major",
    },
    career: {
      playerId: "user-1",
      scoreboard: [{ avgRating: 1.2, avgAdr: 80, kdRatio: 1.4, kpr: 0.8, avgHs: 45, avgWe: 9, avgRws: 12, mkpr: 5, kast: 70, maps: 2, rounds: 48, teamName: null, teamId: null, perfectName: "玩家甲", ratingSamples: 2, fkpr: 0.1, cpr: 0.02, fdpr: 0.08, tradeKpr: 0.04 }],
      scoreboardMaps: [],
      performance: null,
      maps: [],
      coverage: { detailedMaps: 2, completedMaps: 2, maps: [] },
      summary: { matches: 2, wins: 1, losses: 1, mvp: 1, maps: 2, rounds: 48 },
      events: [{ id: "season-1", slug: "event-2025", name: "2025 赛事", maps: ["de_nuke"] }],
      selectedEvent: null,
      mapFilter: undefined,
    },
    currentTeams: [],
    eventTeams: [{ seasonId: "season-1", seasonSlug: "event-2025", seasonName: "2025 赛事", seasonStatus: "finished", teamId: "entry-1", teamName: "队伍甲" }],
    currentEventTeams: [],
    careerHistory: [{ seasonId: "season-1", seasonSlug: "event-2025", seasonName: "2025 赛事", seasonStatus: "finished", teamId: "entry-1", teamName: "队伍甲", placement: "第 2 名", honors: ["最佳选手"], record: { wins: 1, losses: 1, played: 2 } }],
    registrationSnapshots: [{ id: "registration-1", seasonId: "season-1", primaryPosition: "igl", peakRank: "Legend", peakRankSeason: "2025", peakRating: 1900, peakWe: null, highlightVideoUrl: null, seasonName: "2025 赛事", seasonSlug: "event-2025" }],
    publicCompetitiveProfile: [],
    publicCompetitiveRoles: [],
    publicEducationIdentities: [{ institutionName: "南京大学", academicStatus: "在读", verificationLabel: "已认证" }],
    mapPreferences: [],
    playerLft: null,
    radar: null,
  };
}

describe("public Player Profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("React", React);
    canonicalUserMock.mockImplementation(async (_db: unknown, userId: string) => userId);
    profileReadModelMock.mockResolvedValue(profile());
  });

  it("keeps long-lived identity details and event snapshots distinct", async () => {
    const page = await PlayerPageContent({ params: Promise.resolve({ userId: "user-1" }), searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("高校身份");
    expect(html).toContain("南京大学 · 在读 · 已认证");
    expect(html).toContain("当前偏稳健控图");
    expect(html).toContain("参加过 NJU Major");
    expect(html).toContain("报名档案（报名时资料）");
  });

  it("loads the requested event/map scope and exposes the shared metric workspace", async () => {
    const defaultProfile = profile();
    profileReadModelMock.mockResolvedValueOnce({
      ...defaultProfile,
      career: { ...defaultProfile.career, selectedEvent: { id: "season-1", slug: "event-2025", name: "2025 赛事", maps: ["de_nuke"] }, mapFilter: "de_nuke" },
    });
    const page = await PlayerPageContent({
      params: Promise.resolve({ userId: "user-1" }),
      searchParams: Promise.resolve({ event: "event-2025", map: "de_nuke" }),
    });
    const html = renderToStaticMarkup(page);

    expect(profileReadModelMock).toHaveBeenCalledWith("user-1", { eventSlug: "event-2025", mapFilter: "de_nuke" });
    expect(html).toContain("Event and map filters");
    expect(html).toContain("Shared player metrics");
  });

  it("shows event placement, official honor, record, and a scoped stats link", async () => {
    const page = await PlayerPageContent({ params: Promise.resolve({ userId: "user-1" }), searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("第 2 名");
    expect(html).toContain("官方荣誉 · 最佳选手");
    expect(html).toContain("2 场 · 1 胜 / 1 负");
    expect(html).toContain("/event-2025/stats?tab=players&amp;teamFilter=entry-1");
  });
});
