import { describe, expect, it } from "vitest";
import {
  aggregateFinishedPlayerStats,
  buildRoster,
  teamBadgeData,
  type MatchPlayerStatsRow,
} from "@/lib/matches/detail-stats";

function statRow(input: Partial<MatchPlayerStatsRow>): MatchPlayerStatsRow {
  return {
    id: "stat-id",
    matchId: "match-id",
    mapId: "map-id",
    perfectName: "Player",
    userId: null,
    kills: null,
    deaths: null,
    assists: null,
    hsPercent: null,
    firstKills: null,
    firstDeaths: null,
    multiKills: null,
    tradeKills: null,
    kastRounds: null,
    clutches: null,
    adr: null,
    rws: null,
    ratingPro: null,
    we: null,
    dakImportId: null,
    verifiedByAdmin: null,
    verifiedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...input,
  };
}

describe("match detail stats", () => {
  it("builds deterministic team badges", () => {
    expect(teamBadgeData("RivalHub", 0)).toEqual({ tag: "RIV", color: "#ff6b1a" });
    expect(teamBadgeData("Beta", 8)).toEqual({ tag: "BET", color: "#ff6b1a" });
  });

  it("builds roster players from submitted roster member ids", () => {
    expect(
      buildRoster(
        { players: [{ eventRosterMemberId: "member-1", isStarter: true }] },
        [
          {
            id: "member-1",
            teamId: "team-a",
            personaName: "Steam",
            displayName: null,
            perfectName: "Perfect",
            primaryPosition: "rifler",
            userId: "user-1",
            avatarUrl: "https://cdn.test/player.webp",
          },
          {
            id: "member-2",
            teamId: "team-b",
            personaName: "Other",
            displayName: null,
            perfectName: null,
            primaryPosition: "awper",
            userId: "user-2",
            avatarUrl: null,
          },
        ],
        "team-a",
      ),
    ).toEqual([
      {
        personaName: "Steam",
        displayName: null,
        perfectName: "Perfect",
        registrationPosition: "rifler",
        isStarter: true,
        userId: "user-1",
        avatarUrl: "https://cdn.test/player.webp",
      },
    ]);
  });

  it("keeps perfectName available when the Steam cache misses", () => {
    expect(
      buildRoster(
        { players: [{ eventRosterMemberId: "member-1", isStarter: true }] },
        [{
          id: "member-1",
          teamId: "team-a",
          personaName: null,
          displayName: null,
          perfectName: "Perfect fallback",
          primaryPosition: "rifler",
          userId: "user-1",
          avatarUrl: null,
        }],
        "team-a",
      ),
    ).toEqual([{
      personaName: null,
      displayName: null,
      perfectName: "Perfect fallback",
      registrationPosition: "rifler",
      isStarter: true,
      userId: "user-1",
      avatarUrl: null,
    }]);
  });

  it("aggregates finished match stats for MVP candidates and BO summaries", () => {
    const mapRoundsMap = new Map([
      ["map-1", 24],
      ["map-2", 30],
    ]);
    const result = aggregateFinishedPlayerStats(
      [
        statRow({ mapId: "map-1", perfectName: "Alpha", userId: "user-1", kills: 20, deaths: 10, assists: 5, hsPercent: 50, firstKills: 2, multiKills: 3, clutches: 1, adr: 90, rws: 12, ratingPro: 1.3, we: 9 }),
        statRow({ mapId: "map-2", perfectName: "Alpha", userId: "user-1", kills: 10, deaths: 8, assists: 4, hsPercent: 60, firstKills: 1, multiKills: 1, clutches: 0, adr: 80, rws: 10, ratingPro: 1.1, we: 7 }),
        statRow({ mapId: "map-1", perfectName: "Bravo", userId: "user-2", kills: 8, deaths: 15, assists: 2, hsPercent: 40, firstKills: 0, multiKills: 0, clutches: 0, adr: 50, rws: 6, ratingPro: 0.7, we: 4 }),
      ],
      new Map([
        ["user-1", "team-a"],
        ["user-2", "team-b"],
      ]),
      "team-a",
      "team-b",
      mapRoundsMap,
    );

    expect(result.mvpCandidates.map((p) => p.perfectName)).toEqual(["Alpha", "Bravo"]);
    expect(result.summaryPlayers).toMatchObject([
      {
        userId: "user-1",
        perfectName: "Alpha",
        teamId: "team-a",
        mapsPlayed: 2,
        kills: 30,
        deaths: 18,
        assists: 9,
        firstKills: 3,
        multiKills: 4,
        clutches: 1,
        rws: 11,
        we: 8,
      },
      {
        userId: "user-2",
        perfectName: "Bravo",
        teamId: "team-b",
        mapsPlayed: 1,
      },
    ]);
    expect(result.summaryPlayers[0].adr).toBeCloseTo(4560 / 54, 5);
    expect(result.summaryPlayers[0].ratingPro).toBeCloseTo(1.2);
  });
});
