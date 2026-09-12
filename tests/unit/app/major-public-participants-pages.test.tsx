vi.mock("@/lib/seasons/public-stage", () => ({ getPublicSeasonStagePresentation: vi.fn().mockResolvedValue({ stagePlan: [], labels: {}, initializedStageKeys: [], currentStageKey: null, currentStageLabel: null }) }));
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  season: vi.fn(),
  summary: vi.fn(),
  seasonBySlug: vi.fn(),
  projection: vi.fn(),
  team: vi.fn(),
  session: vi.fn(),
}));

vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/components/layout/AdminShortcutSlot", () => ({ AdminShortcutSlot: () => null }));
vi.mock("@/lib/data/public-seasons", () => ({
  getPublicOrAuthorizedDraftSeason: mocks.season,
  getPublicSeasonBySlug: mocks.seasonBySlug,
}));
vi.mock("@/lib/major/public-participants", () => ({
  getMajorPublicParticipantSummary: mocks.summary,
  getMajorPublicParticipantProjection: mocks.projection,
  getMajorPublicParticipantTeam: mocks.team,
}));
vi.mock("@/lib/auth/session", () => ({ getUserSession: mocks.session }));
vi.mock("@/lib/teams/public-profile", () => ({ getPublicTeamProfile: vi.fn().mockResolvedValue(null) }));

vi.mock("@/components/season/ParticipantDirectoryToolbar", () => ({ ParticipantDirectoryToolbar: () => <div /> }));
vi.mock("@/lib/teams/map-profile", () => ({
  getPublicTeamMapProfile: vi.fn().mockResolvedValue({ own: [], experience: [], preferences: [] }),
  getBatchPublicTeamMapPreviews: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock("@/lib/seasons/public-results", () => ({ getPublicSeasonResults: vi.fn().mockResolvedValue({ champion: null, final: null, placements: [], honors: [], completedAt: null, finishedMatches: 0 }) }));
import TeamsPage from "@/app/[seasonSlug]/teams/page";
import PlayersPage from "@/app/[seasonSlug]/players/page";
import DetailPage from "@/app/[seasonSlug]/teams/[entryId]/page";

const season = {
  id: "season-1",
  slug: "nju-major",
  name: "NJU Major",
  status: "registration",
  competitionTemplate: "major",
  registrationMode: "team",
};

const team = {
  season: { id: "season-1", slug: "nju-major", name: "NJU Major", status: "registration" },
  entry: {
    id: "entry-1",
    name: "正式队伍",
    logoUrl: null,
    registrationStatus: "approved",
    representativeUserId: "player-1",
    teamId: null,
  },
  cardLabel: "正式参赛队",
  participation: { label: "正式参赛队", tone: "success", detail: "已进入本届正式参赛队，当前参赛名单仍可能调整。" },
  roster: [{ userId: "player-1", name: "选手甲", avatarUrl: "https://cdn.test/player-1.webp", isStarter: true }],
  rosterLabel: "当前参赛名单",
  rosterStatus: "confirmed",
  seed: null,
  seedPresentation: { label: "种子待确认", tone: "neutral" },
  record: { played: 0, wins: 0, losses: 0, winRate: "—" },
  matches: [],
};

const projection = {
  phase: "final_entrants",
  presentation: {
    teamCollectionLabel: "正式参赛队",
    teamCollectionDescription: "本届正式参赛队已经确定，参赛名单仍可能调整。",
    playerHeading: "正式参赛队选手",
    playerDescription: "以下选手来自本届当前参赛名单；最终名单仍可能调整。",
  },
  entrantCapacity: 32,
  approvedCandidateCount: 33,
  officialEntrantCount: 32,
  teamCount: 1,
  playerCount: 1,
  players: [{
    userId: "player-1",
    avatarUrl: "https://cdn.test/player-1.webp",
    entryId: "entry-1",
    entryName: "正式队伍",
    name: "选手甲",
    isStarter: true,
    stats: null,
  }],
};

describe("Major public participant pages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("React", React);
    mocks.season.mockResolvedValue(season);
    mocks.seasonBySlug.mockResolvedValue(season);
    mocks.summary.mockResolvedValue({
      ...projection,
      teams: [team],
      teamCount: 1,
      playerCount: 1,
      matchCount: 0,
      finishedMatchCount: 0,
    });
    mocks.projection.mockResolvedValue(projection);
    mocks.team.mockResolvedValue(team);
    mocks.session.mockResolvedValue(null);
  });

  it("uses the shared final entrant projection for the teams list", async () => {
    const html = renderToStaticMarkup(await TeamsPage({ params: Promise.resolve({ seasonSlug: "nju-major" }) }));

    expect(mocks.summary).toHaveBeenCalledWith(season);
    expect(html).toContain("正式参赛队");
    expect(html).toContain("正式队伍");
    expect(html).not.toContain("CompetitionEntry");
    expect(html).not.toContain("Draft #");
  });

  it("keeps the detail route on TeamPublicProfile while exposing roster and seed state", async () => {
    const html = renderToStaticMarkup(await DetailPage({ params: Promise.resolve({ seasonSlug: "nju-major", entryId: "entry-1" }) }));

    expect(mocks.team).toHaveBeenCalledWith(season, "entry-1");
    expect(html).toContain("当前参赛名单");
    expect(html).toContain("种子待确认");
    expect(html).not.toContain("EventRoster");
  });

  it("renders Major players from event members without legacy registration fields", async () => {
    const html = renderToStaticMarkup(await PlayersPage({
      params: Promise.resolve({ seasonSlug: "nju-major" }),
      searchParams: Promise.resolve({}),
    }));

    expect(html).toContain("选手");
    expect(html).toContain("选手甲");
    expect(html).toContain("/nju-major/teams/entry-1");
    expect(html).toContain("暂无本届正式比赛数据");
    expect(html).toContain("cdn.test");
    expect(html).not.toContain("Peak Rank");
    expect(html).not.toContain("registrationId");
  });
});
