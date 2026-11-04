import { expect, it } from "vitest";
import type { ScoreboardVersionRow } from "@/lib/ocr/scoreboard-version";
import { scoreboardPayloadDigest, scoreboardVersion } from "@/lib/ocr/scoreboard-version";
import { assertScoreboardReplay, assertScoreboardVersion } from "@/lib/ocr/scoreboard-receipts";

const row: ScoreboardVersionRow = {
  id: "00000000-0000-4000-8000-000000000001", matchId: "match", mapId: "map", perfectName: "Synthetic player", userId: "user",
  kills: 20, deaths: 10, assists: 5, hsPercent: 30, firstKills: 2, firstDeaths: 1, multiKills: 1, tradeKills: 0, kastRounds: 14,
  clutches: 0, adr: 80, rws: 10, ratingPro: 1.2, we: 8, dakImportId: "private-dak-revision", verifiedByAdmin: "private-actor",
  verifiedAtExact: "2026-10-01 00:00:00.000001+00", createdAtExact: "2026-10-01 00:00:00+00",
  verifiedAt: new Date("2026-10-01T00:00:00Z"), createdAt: new Date("2026-10-01T00:00:00Z"),
};
it("includes private DAK/provenance changes in the opaque version independent of row order", () => {
  const second = { ...row, id: "00000000-0000-4000-8000-000000000002" };
  expect(scoreboardVersion("map", [row, second])).toBe(scoreboardVersion("map", [second, row]));
  expect(scoreboardVersion("map", [row])).toMatch(/^[a-f0-9]{64}$/);
  for (const changed of [{ dakImportId: "later-import" }, { verifiedByAdmin: "later-actor" }, { kills: 21 }, { ratingPro: 2 }, { verifiedAtExact: "2026-10-01 00:00:00.000002+00" }]) {
    expect(scoreboardVersion("map", [{ ...row, ...changed }])).not.toBe(scoreboardVersion("map", [row]));
  }
});
it("binds receipt replay to map, operation, base version and canonical input", () => {
  const command = { operationId: "original", expectedActor: "actor", expectedVersion: "a".repeat(64) };
  const digest = scoreboardPayloadDigest("map", "save", command, [{ userId: "user", ratingPro: 1.4 } as { userId: string }]);
  const receipt = { mapId: "map", operation: "save" as const, payloadDigest: digest };
  expect(() => assertScoreboardReplay(receipt, "map", "save", digest)).not.toThrow();
  expect(() => assertScoreboardReplay(receipt, "different", "save", digest)).toThrow();
  expect(() => assertScoreboardReplay(receipt, "map", "clear", digest)).toThrow();
  expect(scoreboardPayloadDigest("map", "save", { ...command, expectedVersion: "b".repeat(64) }, [{ userId: "user", ratingPro: 1.4 } as { userId: string }])).not.toBe(digest);
  expect(scoreboardPayloadDigest("map", "save", command, [{ userId: "user", ratingPro: 9 } as { userId: string }])).not.toBe(digest);
  expect(() => assertScoreboardVersion("current", "stale")).toThrow();
});

it("derives half and overtime scores only from a complete consistent round sequence", async () => {
  const { getRoundSegments } = await import("@/lib/matches/round-segments");
  const winners = ["teamA", "teamB", "teamA", "teamB", "teamA"];
  let a = 0, b = 0;
  const rounds = winners.map((winnerTeamKey, index) => {
    const teamASide = index < 2 ? "ct" as const : "t" as const;
    const fact = { roundSeq: index + 1, phase: index === 4 ? "overtime" as const : "regulation" as const,
      teamASide, teamBSide: teamASide === "ct" ? "t" as const : "ct" as const,
      teamAScoreBefore: a, teamBScoreBefore: b, winnerTeamKey };
    if (winnerTeamKey === "teamA") a++; else b++;
    return fact;
  });
  expect(getRoundSegments(rounds, 3, 2)).toEqual({
    firstHalf: { scoreA: 1, scoreB: 1, sideA: "ct" },
    secondHalf: { scoreA: 1, scoreB: 1, sideA: "t" }, overtime: { scoreA: 1, scoreB: 0 },
  });
  expect(getRoundSegments(rounds.slice(1), 3, 2)).toBeNull();
  expect(getRoundSegments(rounds, 4, 2)).toBeNull();
  expect(getRoundSegments(rounds.map((round, index) => index === 3 ? { ...round, teamASide: "ct" as const, teamBSide: "t" as const } : round), 3, 2)).toBeNull();
});

it("keeps Both scoreboard facts and personal coverage independent of partial advanced projections", async () => {
  const { projectMatchStatsRows, projectMatchWorkspaceScoreboard } = await import("@/lib/matches/scoreboard-view");
  const identities = [{ userId: "user", perfectName: "Synthetic player", teamId: "team" }];
  const basic = { ...identities[0], kills: 50, deaths: 30, assists: 12, adr: 98, ratingPro: 1.3, mapIds: ["map-1", "map-2"] };
  // Only the fields this adapter consumes are needed; the DAK reducer owns their calculation.
  const slice = {
    sample: { rounds: 20 }, combat: { kills: 20, deaths: 10, assists: 5, headshots: 0,
      damagePerRound: { rate: 80 }, twoKillRounds: 1, threeKillRounds: 0, fourKillRounds: 0, fiveKillRounds: 0 },
    utility: { flashAssists: 2 }, trade: { tradedDeaths: 3 }, opening: { firstKills: 2, firstDeaths: 1 },
    clutch: { wins: 0 }, kast: { rate: 0.8 },
  };
  const performance = { player: { entityKey: "user", displayName: "Synthetic player" }, teamEntityKeys: ["team"], mapCount: 1,
    slices: { overall: slice, ct: { ...slice, combat: { ...slice.combat, kills: 7 } }, t: { ...slice, sample: { rounds: 0 } } },
  } as unknown as import("@cs2dak/tournament").TournamentPerformancePlayerSummary;
  const samples = { expectedMapIds: ["map-1", "map-2"], performanceMapIdsByPlayer: new Map([["user", ["map-1"]]]) };
  const singleMap = { expectedMapIds: ["map-1"], performanceMapIdsByPlayer: new Map([["user", ["map-1"]]]) };
  const both = projectMatchStatsRows(identities, [basic], [performance], "overall", samples)[0];
  expect(both).toMatchObject({ kills: 50, deaths: 30, assists: 12, adr: 98, ratingPro: 1.3, kast: 0.8,
    headshots: null, flashAssists: null, tradedDeaths: null, basicCoverage: { maps: 2, expectedMaps: 2 } });
  expect(projectMatchStatsRows(identities, [{ ...basic, kills: null, mapIds: ["map-1"] }], [performance], "overall", samples)[0])
    .toMatchObject({ kills: null, headshots: null, basicCoverage: { maps: 1, expectedMaps: 2 } });
  expect(projectMatchStatsRows(identities, [], [performance], "overall", samples)[0])
    .toMatchObject({ kills: null, adr: null, ratingPro: null, basicCoverage: { maps: 0, expectedMaps: 2 } });
  expect(projectMatchStatsRows(identities, [{ ...basic, mapIds: ["map-1"] }], [performance], "overall", singleMap)[0])
    .toMatchObject({ headshots: 0, flashAssists: 2, tradedDeaths: 3 });
  expect(projectMatchStatsRows(identities, [basic], [performance], "ct", samples)[0])
    .toMatchObject({ kills: 7, adr: 80, ratingPro: null, headshots: 0, basicCoverage: null });
  expect(projectMatchStatsRows(identities, [basic], [performance], "t", { ...samples, performanceMapIdsByPlayer: new Map() })[0])
    .toMatchObject({ kills: null, adr: null, headshots: null });

  // Equal counts do not prove the same maps, and duplicate map IDs do not prove completeness.
  expect(projectMatchStatsRows(identities, [{ ...basic, mapIds: ["map-1"] }], [performance], "overall", {
    ...singleMap, performanceMapIdsByPlayer: new Map([["user", ["map-other"]]]),
  })[0]).toMatchObject({ headshots: null, flashAssists: null, tradedDeaths: null });
  expect(projectMatchStatsRows(identities, [{ ...basic, mapIds: ["map-1", "map-1"] }], [performance], "overall", {
    ...samples, performanceMapIdsByPlayer: new Map([["user", ["map-1", "map-2"]]]),
  })[0]).toMatchObject({ headshots: null, basicCoverage: { maps: 1, expectedMaps: 2 } });
  expect(projectMatchStatsRows(identities, [basic], [performance], "overall", {
    ...samples, performanceMapIdsByPlayer: new Map([["user", ["map-1", "map-1"]]]),
  })[0]).toMatchObject({ headshots: null, advancedCoverage: { maps: 1, expectedMaps: 2 } });

  const { selectUnambiguousMatchStatsRows, aggregateFinishedPlayerStats } = await import("@/lib/matches/detail-stats");
  const conflicting = { ...row, id: "different-row", kills: 999 };
  const otherMap = { ...row, id: "other-map-row", mapId: "map-2", kills: 7 };
  const resolved = selectUnambiguousMatchStatsRows([row, conflicting, otherMap]);
  expect(resolved.rows).toEqual([otherMap]);
  expect(resolved.conflicts.has(`${row.mapId}:${row.userId}`)).toBe(true);
  expect(aggregateFinishedPlayerStats(resolved.rows, new Map([["user", "team"]]), "team", "opponent").summaryPlayers[0])
    .toMatchObject({ kills: 7, mapsPlayed: 1, mapIds: ["map-2"] });

  const firstMap = { ...row, teamId: "team", rounds: 20, ratingPro: 1, adr: 80 };
  const secondMap = { ...row, mapId: "map-2", teamId: "team", rounds: 30, kills: 30, deaths: 20, assists: 7, ratingPro: 1.6, adr: 110 };
  expect(projectMatchWorkspaceScoreboard([firstMap, secondMap])[0]).toMatchObject({
    maps: 2, rounds: 50, avgRating: 1.3, avgAdr: 98, kdRatio: 50 / 30, kpr: 1,
  });
  expect(projectMatchWorkspaceScoreboard([{ ...firstMap, adr: null }])[0])
    .toMatchObject({ maps: 1, rounds: 20, avgAdr: null });
  expect(projectMatchWorkspaceScoreboard([])).toEqual([]);
});
