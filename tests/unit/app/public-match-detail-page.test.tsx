/**
 * @vitest-environment jsdom
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const {
  getPublicOrAuthorizedDraftSeasonMock,
  findFirstMatchMock,
  findFirstEntryMock,
  findManyMapsMock,
  dbSelectMock,
  getMatchRosterMock,
  getUserSessionMock,
  requireSeasonAdminMock,
  loadMatchPreAnalysisMock,
  loadMatchPredictionMock,
  loadMatchScoreboardMock,
  getMatchPlayerDetailMock,
  getMatchTimeProposalViewsMock,
  getMatchMvpResultsMock,
  ensureMvpWinnerMock,
  notFoundMock,
} = vi.hoisted(() => ({
  getPublicOrAuthorizedDraftSeasonMock: vi.fn(),
  findFirstMatchMock: vi.fn(),
  findFirstEntryMock: vi.fn(),
  findManyMapsMock: vi.fn(),
  dbSelectMock: vi.fn(),
  getMatchRosterMock: vi.fn(),
  getUserSessionMock: vi.fn(),
  requireSeasonAdminMock: vi.fn(),
  loadMatchPreAnalysisMock: vi.fn(),
  loadMatchPredictionMock: vi.fn(),
  loadMatchScoreboardMock: vi.fn(),
  getMatchPlayerDetailMock: vi.fn(),
  getMatchTimeProposalViewsMock: vi.fn(),
  getMatchMvpResultsMock: vi.fn(),
  ensureMvpWinnerMock: vi.fn(),
  notFoundMock: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }),
}));

vi.mock("next/navigation", () => ({ notFound: notFoundMock, unstable_rethrow: vi.fn() }));
vi.mock("@/lib/observability/server", () => ({ captureException: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));

vi.mock("@/lib/data/public-seasons", () => ({
  getPublicOrAuthorizedDraftSeason: getPublicOrAuthorizedDraftSeasonMock,
}));

vi.mock("@/db/client", () => ({
  db: {
    query: {
      matches: { findFirst: findFirstMatchMock },
      competitionEntries: { findFirst: findFirstEntryMock },
      matchMaps: { findMany: findManyMapsMock },
      matchMvpVotes: { findFirst: vi.fn().mockResolvedValue(null) },
    },
    select: dbSelectMock,
  },
}));

vi.mock("@/actions/matches/roster", () => ({ getMatchRoster: getMatchRosterMock }));
vi.mock("@/lib/auth/session", () => ({
  getUserSession: getUserSessionMock,
  requireSeasonAdmin: requireSeasonAdminMock,
}));
vi.mock("@/lib/matches/public-phase", () => ({ loadPublicMatchPhase: vi.fn(async (match: { status: string }) => ({ phase: match.status === "finished" ? "post" : match.status === "scheduled" ? "preparation" : "awaiting_gameplay", currentMapId: null })) }));
vi.mock("@/components/matches/MatchRealtime", () => ({ MatchRealtime: () => <div data-testid="match-realtime" /> }));
vi.mock("@/components/matches/MatchContextRefresh", () => ({ MatchContextRefresh: () => null }));
vi.mock("@/lib/matches/pre-analysis", () => ({ loadMatchPreAnalysis: loadMatchPreAnalysisMock }));
vi.mock("@/lib/matches/prediction-read-model", () => ({ loadMatchPrediction: loadMatchPredictionMock }));
vi.mock("@/lib/matches/detail-scoreboard", () => ({ loadMatchScoreboard: loadMatchScoreboardMock }));
vi.mock("@/lib/stats/cached-query", () => ({ getPublicMatchPlayerDetail: getMatchPlayerDetailMock }));
vi.mock("@/lib/matches/time-proposals", () => ({ getMatchTimeProposalViews: getMatchTimeProposalViewsMock }));
vi.mock("@/actions/player-stats", () => ({
  getMatchMvpResults: getMatchMvpResultsMock,
  ensureMvpWinner: ensureMvpWinnerMock,
}));

// Mock child components for structural isolation
vi.mock("@/components/matches/MatchHeroHeader", () => ({
  MatchHeroHeader: ({ match }: { match: { status: string; scoreA: number | null; scoreB: number | null } }) => (
    <header data-testid="match-hero">
      Status: {match.status} | Score: {match.scoreA ?? "—"}:{match.scoreB ?? "—"}
    </header>
  ),
}));
vi.mock("@/components/matches/MatchMapProfile", () => ({
  MatchMapProfile: ({ rows }: { rows: unknown[] }) => (
    <div data-testid="match-map-profile">MapProfile rows:{rows.length}</div>
  ),
}));
vi.mock("@/components/matches/MatchRecentResults", () => ({
  MatchRecentResults: () => <div data-testid="match-recent-results">RecentResults</div>,
}));
vi.mock("@/components/matches/MatchPrediction", () => ({
  MatchPrediction: ({ data }: { data: { participants: number } }) => (
    <div data-testid="match-prediction">Prediction participants:{data.participants}</div>
  ),
}));
vi.mock("@/components/matches/MatchHeadToHead", () => ({
  MatchHeadToHead: ({ teamAWins, teamBWins }: { teamAWins: number; teamBWins: number }) => (
    <div data-testid="match-h2h">H2H: {teamAWins} vs {teamBWins}</div>
  ),
}));
vi.mock("@/components/matches/VetoView", () => ({
  VetoView: () => <div data-testid="veto-view">VetoView</div>,
}));
vi.mock("@/components/matches/MatchRosterView", () => ({
  MatchRosterView: () => <div data-testid="match-roster-view">RosterView</div>,
}));
vi.mock("@/components/matches/MatchSummaryStats", () => ({
  MatchSummaryStats: ({ players }: { players: unknown[] }) => (
    <div data-testid="match-summary-stats">SummaryStats players:{players.length}</div>
  ),
}));
vi.mock("@/components/matches/PlayerStatsTable", () => ({
  PlayerStatsTable: ({ players }: { players: unknown[] }) => (
    <div data-testid="player-stats-table">PlayerStatsTable players:{players.length}</div>
  ),
}));
vi.mock("@/components/stats/players/PlayerWorkspace", () => ({
  PlayerWorkspace: () => <div data-testid="player-workspace">PlayerWorkspace</div>,
}));
vi.mock("@/components/matches/MatchMvpVote", () => ({
  MatchMvpVote: ({ candidates }: { candidates: unknown[] }) => (
    <div data-testid="match-mvp-vote">MvpVote candidates:{candidates.length}</div>
  ),
}));
vi.mock("@/components/matches/MatchLiveViewing", () => ({
  MatchLiveViewing: ({ status }: { status: string }) => (
    <div data-testid="match-live-viewing">LiveViewing: {status}</div>
  ),
}));

import MatchDetailPage from "@/app/[seasonSlug]/matches/[matchId]/page";

const seasonFixture = {
  id: "season-1",
  slug: "spring-2026",
  name: "Spring 2026",
  competitionTemplate: "custom",
  registrationConfig: { mapPool: ["de_ancient", "de_mirage", "de_nuke"] },
  stagePlan: [],
};

const teamAFixture = { id: "entry-a", name: "Team Alpha", representativeUserId: "user-cap-a" };
const teamBFixture = { id: "entry-b", name: "Team Beta", representativeUserId: "user-cap-b" };

interface MockQueryChain {
  from: () => MockQueryChain;
  innerJoin: () => MockQueryChain;
  leftJoin: () => MockQueryChain;
  where: () => MockQueryChain;
  orderBy: () => MockQueryChain;
  then: <TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) => Promise<TResult1 | TResult2>;
  catch: <TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ) => Promise<unknown[] | TResult>;
}

function createQueryChain(): MockQueryChain {
  const target: MockQueryChain = {
    from: () => createQueryChain(),
    innerJoin: () => createQueryChain(),
    leftJoin: () => createQueryChain(),
    where: () => createQueryChain(),
    orderBy: () => createQueryChain(),
    then: (resolve) => Promise.resolve([]).then(resolve),
    catch: (reject) => Promise.resolve([]).catch(reject),
  };
  return target;
}

function setupSelectChain() {
  dbSelectMock.mockImplementation(() => createQueryChain());
}

describe("Public Match Detail Page (PRE / POST)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupSelectChain();
    getPublicOrAuthorizedDraftSeasonMock.mockResolvedValue(seasonFixture);
    let entryCall = 0;
    findFirstEntryMock.mockImplementation(() => {
      entryCall += 1;
      return Promise.resolve(entryCall % 2 === 1 ? teamAFixture : teamBFixture);
    });
    getMatchRosterMock.mockResolvedValue(null);
    getUserSessionMock.mockResolvedValue(null);
    getMatchTimeProposalViewsMock.mockResolvedValue([]);
  });

  describe("PRE Spectator Experience", () => {
    it("renders scheduled match with roster, map profile, recent results, prediction, H2H and Veto Room entry", async () => {
      findFirstMatchMock.mockResolvedValue({
        id: "match-scheduled",
        seasonId: "season-1",
        entryAId: "entry-a",
        entryBId: "entry-b",
        status: "scheduled",
        format: "bo3",
        stage: "group",
        scoreA: null,
        scoreB: null,
        scheduledAt: new Date("2026-09-01T10:00:00Z"),
      });
      findManyMapsMock.mockResolvedValue([]);

      loadMatchPreAnalysisMock.mockResolvedValue({
        mapProfileRows: [{ mapName: "de_ancient", a: { win: { count: 1, sample: 1 }, pick: { count: 0, sample: 0 }, ban: { count: 0, sample: 0 } }, b: { win: { count: 0, sample: 1 }, pick: { count: 0, sample: 0 }, ban: { count: 0, sample: 0 } } }],
        recentResultsA: [{ matchId: "m-1", opponentName: "Team C", scoreFor: 2, scoreAgainst: 1, won: true, format: "bo3", playedAt: new Date() }],
        recentResultsB: [],
        h2hMatches: [{ matchId: "h-1", scheduledAt: null, completedAt: new Date(), stage: "group", format: "bo3", scoreA: 2, scoreB: 0, teamAWon: true }],
        h2hWinsA: 1,
        h2hWinsB: 0,
      });

      loadMatchPredictionMock.mockResolvedValue({
        shares: [{ entryId: "entry-a", percent: 65 }, { entryId: "entry-b", percent: 35 }],
        participants: 42,
        deadline: new Date("2026-09-01T09:30:00Z").toISOString(),
        closed: false,
        myStake: null,
      });

      const jsx = await MatchDetailPage({
        params: Promise.resolve({ seasonSlug: "spring-2026", matchId: "match-scheduled" }),
        searchParams: Promise.resolve({}),
      });
      const html = renderToStaticMarkup(jsx);

      expect(html).toContain("Status: scheduled");
      expect(html).toContain('data-testid="match-hero"');
      expect(html).toContain('data-testid="match-roster-view"');
      expect(html).toContain('data-testid="match-map-profile"');
      expect(html).toContain('data-testid="match-recent-results"');
      expect(html).toContain('data-testid="match-prediction"');
      expect(html).toContain('data-testid="match-h2h"');
      expect(html).toContain("查看 BP 进度");
      expect(html).not.toContain('data-testid="match-summary-stats"');
      expect(html).not.toContain('data-testid="match-mvp-vote"');
      expect(loadMatchScoreboardMock).not.toHaveBeenCalled();
    });

    it("gracefully renders empty state when pre-analysis has no scouting or prediction data", async () => {
      findFirstMatchMock.mockResolvedValue({
        id: "match-empty-pre",
        seasonId: "season-1",
        entryAId: "entry-a",
        entryBId: "entry-b",
        status: "scheduled",
        format: "bo1",
        stage: "group",
        scoreA: null,
        scoreB: null,
        scheduledAt: null,
      });
      findManyMapsMock.mockResolvedValue([]);
      loadMatchPreAnalysisMock.mockResolvedValue({
        mapProfileRows: [],
        recentResultsA: [],
        recentResultsB: [],
        h2hMatches: [],
        h2hWinsA: 0,
        h2hWinsB: 0,
      });
      loadMatchPredictionMock.mockResolvedValue(null);

      const jsx = await MatchDetailPage({
        params: Promise.resolve({ seasonSlug: "spring-2026", matchId: "match-empty-pre" }),
        searchParams: Promise.resolve({}),
      });
      const html = renderToStaticMarkup(jsx);

      expect(html).toContain("Status: scheduled");
      expect(html).toContain('data-testid="match-roster-view"');
      expect(html).not.toContain('data-testid="match-map-profile"');
      expect(html).not.toContain('data-testid="match-recent-results"');
      expect(html).not.toContain('data-testid="match-prediction"');
      expect(html).not.toContain('data-testid="match-h2h"');
      expect(html).toContain("查看 BP 进度");
    });
  });

  describe("POST Spectator Experience", () => {
    it("renders BO3 series result, map scoreboards, summary stats, MVP, roster, VOD and detailed stats deep-link", async () => {
      findFirstMatchMock.mockResolvedValue({
        id: "match-finished-bo3",
        seasonId: "season-1",
        entryAId: "entry-a",
        entryBId: "entry-b",
        status: "finished",
        format: "bo3",
        stage: "playoff",
        scoreA: 2,
        scoreB: 1,
        completedAt: new Date("2026-09-02T12:00:00Z"),
        videoUrl: "https://vod.example/match-finished-bo3",
      });
      findManyMapsMock.mockResolvedValue([
        { id: "map-1", matchId: "match-finished-bo3", mapOrder: 1, mapName: "de_ancient", scoreA: 13, scoreB: 9, pickedByEntryId: "entry-a", teamAStartSide: "ct", completedAt: new Date() },
        { id: "map-2", matchId: "match-finished-bo3", mapOrder: 2, mapName: "de_mirage", scoreA: 8, scoreB: 13, pickedByEntryId: "entry-b", teamAStartSide: "t", completedAt: new Date() },
        { id: "map-3", matchId: "match-finished-bo3", mapOrder: 3, mapName: "de_nuke", scoreA: 13, scoreB: 11, pickedByEntryId: null, teamAStartSide: "ct", completedAt: new Date() },
      ]);

      loadMatchScoreboardMock.mockResolvedValue({
        completed: [{ id: "map-1", scoreA: 13, scoreB: 9, mapName: "de_ancient" }, { id: "map-2", scoreA: 8, scoreB: 13, mapName: "de_mirage" }, { id: "map-3", scoreA: 13, scoreB: 11, mapName: "de_nuke" }],
        confirmedMapIds: new Set(["map-1", "map-2", "map-3"]),
        mapPlayers: new Map([
          ["map-1", [{ userId: "u-1", perfectName: "Player 1", teamId: "entry-a" }]],
          ["map-2", [{ userId: "u-1", perfectName: "Player 1", teamId: "entry-a" }]],
          ["map-3", [{ userId: "u-1", perfectName: "Player 1", teamId: "entry-a" }]],
        ]),
        detailedPlayers: [{ userId: "u-1", name: "Player 1" }],
        detailedPlayerIds: new Set(["u-1"]),
        detailedMapIds: new Set(["map-1", "map-2", "map-3"]),
        mvpCandidates: [{ userId: "u-1", perfectName: "Player 1", kills: 55, deaths: 35 }],
        summaryPlayers: [{ userId: "u-1", perfectName: "Player 1", teamId: "entry-a", kills: 55, deaths: 35, mapsPlayed: 3 }],
      });

      getMatchPlayerDetailMock.mockResolvedValue({
        playerId: "u-1",
        playerName: "Player 1",
        performance: { rating: 1.25, kills: 55, deaths: 35, slices: { overall: { clutch: { wins: 2 }, sample: { rounds: 67 } } } },
      });
      getMatchMvpResultsMock.mockResolvedValue([{ candidateName: "Player 1", votes: 12 }]);

      const jsx = await MatchDetailPage({
        params: Promise.resolve({ seasonSlug: "spring-2026", matchId: "match-finished-bo3" }),
        searchParams: Promise.resolve({ statsPlayer: "u-1" }),
      });
      const html = renderToStaticMarkup(jsx);

      expect(html).toContain("Status: finished | Score: 2:1");
      expect(html).toContain('data-testid="match-summary-stats"');
      expect(html).toContain('data-testid="player-workspace"');
      expect(html).toContain('data-testid="match-mvp-vote"');
      expect(html).toContain("观看比赛录像 →");
      expect(html).toContain("BP 记录");
      expect(html.indexOf('data-testid="match-bp-record"')).toBeLessThan(html.indexOf('data-testid="match-mvp-vote"'));
      expect(html.match(/data-testid="veto-view"/g)).toHaveLength(1);
      expect(loadMatchPreAnalysisMock).not.toHaveBeenCalled();
      expect(loadMatchPredictionMock).not.toHaveBeenCalled();
    });

    it("reads MVP whole-match metrics through the public cache even when a different map/player is selected", async () => {
      findFirstMatchMock.mockResolvedValue({ id: "finished", seasonId: "season-1", entryAId: "entry-a", entryBId: "entry-b", status: "finished", format: "bo3", stage: "playoff", completedAt: new Date(), mvpWinnerUserId: "winner" });
      findManyMapsMock.mockResolvedValue([{ id: "map-1", mapOrder: 1, mapName: "de_ancient", scoreA: 13, scoreB: 9, completedAt: new Date() }]);
      loadMatchScoreboardMock.mockResolvedValue({ completed: [], confirmedMapIds: new Set(), mapPlayers: new Map(), detailedPlayers: [{ userId: "winner", name: "Winner" }, { userId: "other", name: "Other" }], detailedPlayerIds: new Set(["winner", "other"]), detailedMapIds: new Set(["map-1"]), mvpCandidates: [], summaryPlayers: [] });
      getMatchMvpResultsMock.mockResolvedValue([]);
      getMatchPlayerDetailMock.mockResolvedValue(null);
      await MatchDetailPage({ params: Promise.resolve({ seasonSlug: "spring-2026", matchId: "finished" }), searchParams: Promise.resolve({ statsPlayer: "other", statsMap: "map-1" }) });
      expect(getMatchPlayerDetailMock).toHaveBeenCalledWith("finished", "other", "de_ancient", "public");
      expect(getMatchPlayerDetailMock).toHaveBeenCalledWith("finished", "winner", undefined, "public");
      getMatchPlayerDetailMock.mockClear();
      await MatchDetailPage({ params: Promise.resolve({ seasonSlug: "spring-2026", matchId: "finished" }), searchParams: Promise.resolve({}) });
      expect(getMatchPlayerDetailMock).toHaveBeenCalledTimes(1);
      expect(getMatchPlayerDetailMock).toHaveBeenCalledWith("finished", "winner", undefined, "public");
    });

    it("renders per-map scoreboard in the active map tab when summary is not shown", async () => {
      findFirstMatchMock.mockResolvedValue({
        id: "match-single-map",
        seasonId: "season-1",
        entryAId: "entry-a",
        entryBId: "entry-b",
        status: "in_progress",
        format: "bo1",
        stage: "group",
        scoreA: null,
        scoreB: null,
      });
      findManyMapsMock.mockResolvedValue([
        { id: "map-single", matchId: "match-single-map", mapOrder: 1, mapName: "de_ancient", scoreA: 13, scoreB: 9, pickedByEntryId: "entry-a", teamAStartSide: "ct", completedAt: new Date() },
      ]);
      loadMatchScoreboardMock.mockResolvedValue({
        completed: [{ id: "map-single", scoreA: 13, scoreB: 9, mapName: "de_ancient" }],
        confirmedMapIds: new Set(["map-single"]),
        mapPlayers: new Map([
          ["map-single", [{ userId: "u-1", perfectName: "Player 1", teamId: "entry-a" }]],
        ]),
        detailedPlayers: [],
        detailedPlayerIds: new Set(),
        detailedMapIds: new Set(),
        mvpCandidates: [],
        summaryPlayers: [],
      });

      const jsx = await MatchDetailPage({
        params: Promise.resolve({ seasonSlug: "spring-2026", matchId: "match-single-map" }),
        searchParams: Promise.resolve({}),
      });
      const html = renderToStaticMarkup(jsx);

      expect(html).toContain('data-testid="player-stats-table"');
      expect(html).toContain("PlayerStatsTable players:1");
      expect(html).not.toContain('data-testid="match-summary-stats"');
    });

    it("does not fabricate map stats for a forfeited match", async () => {
      findFirstMatchMock.mockResolvedValue({
        id: "match-forfeit",
        seasonId: "season-1",
        entryAId: "entry-a",
        entryBId: "entry-b",
        status: "finished",
        format: "bo1",
        stage: "group",
        scoreA: 1,
        scoreB: 0,
        isForfeit: true,
        completedAt: new Date(),
      });
      findManyMapsMock.mockResolvedValue([]);
      loadMatchScoreboardMock.mockResolvedValue({
        completed: [],
        confirmedMapIds: new Set(),
        mapPlayers: new Map(),
        detailedPlayers: [],
        detailedPlayerIds: new Set(),
        detailedMapIds: new Set(),
        mvpCandidates: [],
        summaryPlayers: [],
      });

      const jsx = await MatchDetailPage({
        params: Promise.resolve({ seasonSlug: "spring-2026", matchId: "match-forfeit" }),
        searchParams: Promise.resolve({}),
      });
      const html = renderToStaticMarkup(jsx);

      expect(html).toContain("本场比赛以弃赛结束，未进行实际对局。");
      expect(html).not.toContain('data-testid="player-stats-table"');
      expect(html).not.toContain('data-testid="player-workspace"');
    });
  });

  describe("Security & Separation Boundary", () => {
    it("keeps the official scoreboard visible when advanced-statistics transport is unavailable", async () => {
      findFirstMatchMock.mockResolvedValue({
        id: "match-unavailable", seasonId: "season-1", entryAId: "entry-a", entryBId: "entry-b",
        status: "in_progress", format: "bo3", stage: "group", scoreA: null, scoreB: null,
      });
      findManyMapsMock.mockResolvedValue([{
        id: "map-single", matchId: "match-unavailable", mapOrder: 1, mapName: "de_ancient",
        scoreA: 13, scoreB: 9, completedAt: new Date(),
      }]);
      loadMatchScoreboardMock.mockResolvedValue({
        completed: [{ id: "map-single", scoreA: 13, scoreB: 9, mapName: "de_ancient" }],
        confirmedMapIds: new Set(["map-single"]),
        mapPlayers: new Map([["map-single", [{ userId: "u-1", perfectName: "Player 1", teamId: "entry-a" }]]]),
        detailedPlayers: [{ userId: "u-1", name: "Player 1" }],
        detailedPlayerIds: new Set(["u-1"]), detailedMapIds: new Set(["map-single"]),
        mvpCandidates: [], summaryPlayers: [],
      });
      getMatchPlayerDetailMock.mockRejectedValueOnce(Object.assign(new Error("provider unavailable"), { code: "ECONNREFUSED" }));

      const html = renderToStaticMarkup(await MatchDetailPage({
        params: Promise.resolve({ seasonSlug: "spring-2026", matchId: "match-unavailable" }),
        searchParams: Promise.resolve({}),
      }));

      expect(html).toContain('data-testid="player-stats-table"');
      expect(html).toContain("高级统计暂时无法加载");
      expect(html).not.toContain('data-testid="player-workspace"');
      expect(getMatchPlayerDetailMock).toHaveBeenCalledOnce();
    });

    it("never imports or renders StatsOCRPanel on the public spectator route", () => {
      const pageSource = readFileSync(
        resolve(process.cwd(), "src/app/[seasonSlug]/matches/[matchId]/page.tsx"),
        "utf8",
      );

      expect(pageSource).not.toContain("StatsOCRPanel");
      expect(pageSource).not.toContain("savePlayerStats");
      expect(pageSource).not.toContain("deletePlayerStatsByMap");
      expect(pageSource).not.toContain("clearOperatorScoreboardInTx");
      expect(pageSource).not.toContain("dakImportId");
      expect(pageSource).not.toContain("verifiedByAdmin");
      expect(pageSource).toContain("MatchRealtime");
      expect(pageSource).not.toContain("runtime-presentation");
      expect(pageSource).not.toContain("cs2-radar-assets");
    });
  });
});
