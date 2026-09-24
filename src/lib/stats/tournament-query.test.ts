import { describe, expect, it } from "vitest";

import { scopePerformanceFactsToTeam } from "./tournament-query";

describe("team performance fact scoping", () => {
  it("keeps a transferred player's advanced facts only for the represented team", () => {
    const playerId = "player-1";
    const facts = {
      teamEntityKeys: { teamA: "team-a", teamB: "team-b" },
      playerRounds: [
        { playerEntityKey: playerId, teamEntityKey: "team-a", roundNumber: 1 },
        { playerEntityKey: playerId, teamEntityKey: "team-b", roundNumber: 2 },
      ],
      objectives: [
        { playerEntityKey: playerId, teamEntityKey: "team-a", roundNumber: 1 },
        { playerEntityKey: playerId, teamEntityKey: "team-b", roundNumber: 2 },
      ],
      playerWeapons: [
        { playerEntityKey: playerId, teamEntityKey: "team-a", weapon: "ak47" },
        { playerEntityKey: playerId, teamEntityKey: "team-b", weapon: "m4a1" },
      ],
    } as Parameters<typeof scopePerformanceFactsToTeam>[0];

    const scoped = scopePerformanceFactsToTeam(facts, "team-a");

    expect(scoped.playerRounds).toHaveLength(1);
    expect(scoped.playerRounds[0]?.teamEntityKey).toBe("team-a");
    expect(scoped.objectives).toHaveLength(1);
    expect(scoped.objectives[0]?.teamEntityKey).toBe("team-a");
    expect(scoped.playerWeapons).toHaveLength(1);
    expect(scoped.playerWeapons[0]?.teamEntityKey).toBe("team-a");
  });
});
