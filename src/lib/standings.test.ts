import { describe, it, expect } from "vitest";
import { calculateStandings } from "@/lib/standings";

// Helper to construct a minimal Team-like object
function t(id: string, name: string, draftOrder: number) {
  return {
    id,
    name,
    draftOrder,
    seasonId: "s1",
    captainRegistrationId: "cr1",
    createdAt: new Date(),
  } as any;
}

// Helper to construct a minimal finished Match-like object
function m(
  id: string,
  teamAId: string,
  teamBId: string,
  scoreA: number,
  scoreB: number,
) {
  return {
    id,
    seasonId: "s1",
    teamAId,
    teamBId,
    stage: "qualifier",
    format: "bo1",
    status: "finished",
    scoreA,
    scoreB,
    bracketNodeId: null,
    round: null,
    entryRound: null,
    scheduledAt: null,
    completedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any;
}

describe("calculateStandings", () => {
  it("scores wins and losses correctly", () => {
    const teams = [t("t1", "Alpha", 1), t("t2", "Bravo", 2)];
    const matches = [m("m1", "t1", "t2", 13, 8)];
    const result = calculateStandings(teams, matches);
    expect(result[0].teamName).toBe("Alpha");
    expect(result[0].wins).toBe(1);
    expect(result[0].losses).toBe(0);
    expect(result[1].wins).toBe(0);
    expect(result[1].losses).toBe(1);
  });

  it("calculates netRounds and totalRoundsWon", () => {
    const teams = [t("t1", "A", 1), t("t2", "B", 2)];
    const matches = [m("m1", "t1", "t2", 13, 8)];
    const result = calculateStandings(teams, matches);
    const a = result.find((r: any) => r.teamName === "A")!;
    expect(a.netRounds).toBe(5);
    expect(a.totalRoundsWon).toBe(13);
  });

  it("breaks ties with netRounds before totalRoundsWon", () => {
    const teams = [t("t1", "A", 1), t("t2", "B", 2), t("t3", "C", 3)];
    const matches = [
      m("m1", "t1", "t2", 13, 10),
      m("m2", "t1", "t3", 10, 13),
      m("m3", "t2", "t3", 13, 8),
    ];
    const result = calculateStandings(teams, matches);
    expect(result[0].teamName).toBe("B"); // best netRounds (+2)
    expect(result[1].teamName).toBe("A"); // next netRounds (0)
    expect(result[2].teamName).toBe("C"); // lowest (-2)
  });

  it("falls back to draftOrder when all else is equal", () => {
    const teams = [t("t1", "A", 3), t("t2", "B", 1)];
    const matches: any[] = [];
    const result = calculateStandings(teams, matches);
    expect(result[0].draftOrder).toBe(1);
    expect(result[1].draftOrder).toBe(3);
  });

  it("assigns seeds 1-based", () => {
    const teams = [t("t1", "A", 1), t("t2", "B", 2)];
    const matches = [m("m1", "t1", "t2", 13, 8)];
    const result = calculateStandings(teams, matches);
    expect(result[0].seed).toBe(1);
    expect(result[1].seed).toBe(2);
  });
});
