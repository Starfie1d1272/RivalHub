import { describe, expect, it } from "vitest";

import { calculateStandings } from "@/lib/standings";
import type { Team } from "@/db/schema/teams";
import type { Match } from "@/db/schema/matches";

function makeTeam(id: string, name: string, draftOrder: number): Team {
  return { id, name, seasonId: "s1", draftOrder } as Team;
}

function fm(overrides: Record<string, unknown> = {}): Match {
  return {
    id: "m",
    seasonId: "s1",
    stage: "qualifier",
    status: "finished",
    teamAId: "t1",
    teamBId: "t2",
    scoreA: 13,
    scoreB: 8,
    format: "bo1",
    round: null,
    entryRound: null,
    bracketNodeId: null,
    scheduledAt: null,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Match;
}

describe("calculateStandings", () => {
  it("无比赛时按 draftOrder 排序，全队 0-0", () => {
    const teams = [makeTeam("t2", "B队", 2), makeTeam("t1", "A队", 1)];
    const standings = calculateStandings(teams, []);
    expect(standings[0].teamId).toBe("t1");
    expect(standings[0].seed).toBe(1);
    expect(standings[0].wins).toBe(0);
    expect(standings[0].losses).toBe(0);
    expect(standings[1].teamId).toBe("t2");
    expect(standings[1].seed).toBe(2);
  });

  it("单场胜负正确统计 wins/losses/netRounds/totalRoundsWon", () => {
    const finishedMatches = [
      fm({ teamAId: "t1", teamBId: "t2", scoreA: 13, scoreB: 8 }),
    ];
    const teams = [makeTeam("t1", "A队", 1), makeTeam("t2", "B队", 2)];
    const standings = calculateStandings(teams, finishedMatches);
    expect(standings[0].teamId).toBe("t1");
    expect(standings[0].wins).toBe(1);
    expect(standings[0].losses).toBe(0);
    expect(standings[0].netRounds).toBe(5);
    expect(standings[0].totalRoundsWon).toBe(13);

    expect(standings[1].teamId).toBe("t2");
    expect(standings[1].wins).toBe(0);
    expect(standings[1].losses).toBe(1);
    expect(standings[1].netRounds).toBe(-5);
    expect(standings[1].totalRoundsWon).toBe(8);
  });

  it("胜场优先于净胜回合排序", () => {
    // t1 2-0, t2 1-1, t3 0-2
    const finishedMatches = [
      fm({ teamAId: "t1", teamBId: "t2", scoreA: 13, scoreB: 11 }),
      fm({ teamAId: "t1", teamBId: "t3", scoreA: 13, scoreB: 11 }),
      fm({ teamAId: "t2", teamBId: "t3", scoreA: 16, scoreB: 1 }),
    ];
    const teams = [
      makeTeam("t1", "A队", 1),
      makeTeam("t2", "B队", 2),
      makeTeam("t3", "C队", 3),
    ];
    const standings = calculateStandings(teams, finishedMatches);
    expect(standings[0].teamId).toBe("t1");
    expect(standings[0].wins).toBe(2);
    expect(standings[2].teamId).toBe("t3");
    expect(standings[2].losses).toBe(2);
  });

  it("同胜场同净胜时按总胜回合排序", () => {
    // 两队都只打了一场，都是 1-0 +5 净胜，但 t1 16 回合胜 > t3 13 回合胜
    const finishedMatches = [
      fm({ teamAId: "t1", teamBId: "t2", scoreA: 16, scoreB: 3 }),
      fm({ teamAId: "t3", teamBId: "t4", scoreA: 13, scoreB: 8 }),
    ];
    const teams = [
      makeTeam("t1", "A队", 1),
      makeTeam("t2", "B队", 2),
      makeTeam("t3", "C队", 3),
      makeTeam("t4", "D队", 4),
    ];
    const standings = calculateStandings(teams, finishedMatches);
    // t1 和 t3 都是 1-0，但 t1 totalRoundsWon=16 > t3=13
    expect(standings[0].teamId).toBe("t1");
    expect(standings[0].totalRoundsWon).toBe(16);
    expect(standings[1].teamId).toBe("t3");
    expect(standings[1].totalRoundsWon).toBe(13);
  });

  it("相互战绩打破平局", () => {
    // t1 和 t2 都是 1-1，但 t1 赢了 t2
    const finishedMatches = [
      fm({ teamAId: "t1", teamBId: "t2", scoreA: 13, scoreB: 11 }), // t1 wins h2h
      fm({ teamAId: "t1", teamBId: "t3", scoreA: 8, scoreB: 13 }),  // t1 loses
      fm({ teamAId: "t2", teamBId: "t3", scoreA: 13, scoreB: 8 }),  // t2 wins
    ];
    const teams = [
      makeTeam("t1", "A队", 1),
      makeTeam("t2", "B队", 2),
      makeTeam("t3", "C队", 3),
    ];
    const standings = calculateStandings(teams, finishedMatches);
    // t2 +3, t3 0, t1 -3 → t2 #1, t3 #2, t1 #3
    expect(standings[0].teamId).toBe("t2");
    expect(standings[1].teamId).toBe("t3");
    expect(standings[2].teamId).toBe("t1");
  });

  it("无已完成比赛时按 draftOrder 排序", () => {
    const teams = [makeTeam("t1", "A队", 1), makeTeam("t2", "B队", 2)];
    const standings = calculateStandings(teams, []);
    expect(standings[0].wins).toBe(0);
    expect(standings[1].wins).toBe(0);
  });
});
