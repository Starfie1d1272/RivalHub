import { describe, expect, it } from "vitest";
import {
  aggregateFinishedPlayerStats,
  buildLineupsPlayers,
  buildRadarData,
  buildRoster,
  computeRecord,
  computeTeamAvgStats,
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
    multiKills: null,
    clutches: null,
    adr: null,
    rws: null,
    ratingPro: null,
    we: null,
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

  it("computes team record from finished scores", () => {
    expect(
      computeRecord("team-a", [
        { teamAId: "team-a", teamBId: "team-b", scoreA: 13, scoreB: 8 },
        { teamAId: "team-c", teamBId: "team-a", scoreA: 13, scoreB: 11 },
        { teamAId: "team-a", teamBId: "team-d", scoreA: null, scoreB: null },
      ]),
    ).toEqual({ wins: 1, losses: 1 });
  });

  it("computes average team stats with kill/death ratio", () => {
    expect(
      computeTeamAvgStats([
        statRow({ kills: 20, deaths: 10, adr: 90, ratingPro: 1.2 }),
        statRow({ kills: 10, deaths: 15, adr: 70, ratingPro: 0.8 }),
      ]),
    ).toEqual({ avgRating: 1, avgAdr: 80, avgKd: 1.2 });
  });

  it("builds radar percentages from map stats", () => {
    const radar = buildRadarData(
      ["mirage", "nuke"],
      new Map([["mirage", { mapName: "mirage", played: 4, wins: 3 }]]),
      { pickCount: new Map([["mirage", 2]]), bpMatchCount: 4 },
      { banCount: new Map([["nuke", 1]]), bpMatchCount: 4 },
    );

    expect(radar.get("mirage")).toEqual({ winRate: 75, pickRate: 50, banRate: 0 });
    expect(radar.get("nuke")).toEqual({ winRate: 0, pickRate: 0, banRate: 25 });
  });

  it("builds roster players from submitted roster member ids", () => {
    expect(
      buildRoster(
        { players: [{ teamMemberId: "member-1", isStarter: true }] },
        [
          {
            id: "member-1",
            teamId: "team-a",
            steamName: "Steam",
            displayName: null,
            perfectName: "Perfect",
            primaryPosition: "rifler",
            userId: "user-1",
          },
          {
            id: "member-2",
            teamId: "team-b",
            steamName: "Other",
            displayName: null,
            perfectName: null,
            primaryPosition: "awper",
            userId: "user-2",
          },
        ],
        "team-a",
      ),
    ).toEqual([
      {
        steamName: "Steam",
        displayName: null,
        perfectName: "Perfect",
        primaryPosition: "rifler",
        isStarter: true,
        userId: "user-1",
      },
    ]);
  });

  it("builds lineup player summaries from starter stats", () => {
    const players = buildLineupsPlayers(
      [
        statRow({ matchId: "match-1", perfectName: "Alpha", userId: "user-1", kills: 20, deaths: 10, firstKills: 2, hsPercent: 50, adr: 90, ratingPro: 1.2, we: 9 }),
        statRow({ matchId: "match-2", perfectName: "Alpha", userId: "user-1", kills: 10, deaths: 10, firstKills: 1, hsPercent: 30, adr: 70, ratingPro: 1, we: 7 }),
      ],
      ["user-1"],
      new Map([["user-1", { id: "member-1", teamId: "team-a", steamName: "Steam", displayName: null, perfectName: "Alpha", primaryPosition: "rifler", userId: "user-1" }]]),
      new Map([
        ["match-1", 24],
        ["match-2", 30],
      ]),
    );

    expect(players).toEqual([
      {
        userId: "user-1",
        perfectName: "Alpha",
        maps: 2,
        avgRating: 1.1,
        avgAdr: 80,
        kdRatio: 1.5,
        avgHs: 40,
        fkpr: 3 / 54,
        avgWe: 8,
      },
    ]);
  });

  it("aggregates finished match stats for MVP candidates and BO summaries", () => {
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
        adr: 85,
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
    expect(result.summaryPlayers[0].ratingPro).toBeCloseTo(1.2);
  });
});
