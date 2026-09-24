import { describe, expect, it } from "vitest";
import { buildTournamentPerformanceAnalytics } from "@cs2dak/tournament";
import normal from "../../../tests/fixtures/demo-evidence/normal-map-v1.json";
import overtime from "../../../tests/fixtures/demo-evidence/overtime-map-v1.json";
import { parseRivalHubDemoEvidenceV1 } from "@/lib/demo-evidence/contract";
import { adaptStatsEvidence } from "./evidence-adapter";
import { remapLinkedTeamFacts, scopePerformanceFactsToTeam } from "./tournament-query";

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
    } as unknown as Parameters<typeof scopePerformanceFactsToTeam>[0];

    const scoped = scopePerformanceFactsToTeam(facts, "team-a");

    expect(scoped.playerRounds).toHaveLength(1);
    expect(scoped.playerRounds[0]?.teamEntityKey).toBe("team-a");
    expect(scoped.objectives).toHaveLength(1);
    expect(scoped.objectives[0]?.teamEntityKey).toBe("team-a");
    expect(scoped.playerWeapons).toHaveLength(1);
    expect(scoped.playerWeapons[0]?.teamEntityKey).toBe("team-a");
  });
});


describe("long-team transferred-player projection", () => {
  it("keeps advanced player metrics only from rounds represented for the linked team", () => {
    const firstEvidence = parseRivalHubDemoEvidenceV1(normal);
    const secondEvidence = parseRivalHubDemoEvidenceV1(overtime);
    const linkedEntryId = firstEvidence.target.entryAId;
    const longTeamId = "long-team-a";
    const transferredUserId = "transferred-player";

    const firstBindings = new Map(firstEvidence.participants.map((row, index) => [
      row.steamId64,
      {
        userId: index === 0 ? transferredUserId : `first-${index}`,
        entryId: row.observedTeamKey === "teamA" ? linkedEntryId : firstEvidence.target.entryBId,
      },
    ]));
    const secondTeamB = secondEvidence.target.entryBId;
    const transferredSteamId = secondEvidence.participants.find((row) => row.observedTeamKey === "teamB")!.steamId64;
    const secondBindings = new Map(secondEvidence.participants.map((row, index) => [
      row.steamId64,
      {
        userId: row.steamId64 === transferredSteamId ? transferredUserId : `second-${index}`,
        entryId: row.observedTeamKey === "teamA" ? linkedEntryId : secondTeamB,
      },
    ]));

    const first = adaptStatsEvidence(firstEvidence, firstBindings);
    const second = adaptStatsEvidence(secondEvidence, secondBindings);
    second.tournament.mapKey = "transfer-map";
    second.performance.mapKey = "transfer-map";

    const projected = remapLinkedTeamFacts([
      { importId: "first", facts: first },
      { importId: "second", facts: second },
    ] as Parameters<typeof remapLinkedTeamFacts>[0], new Set([linkedEntryId]), longTeamId);

    const performance = buildTournamentPerformanceAnalytics(projected.map((row) => row.facts.performance));
    const player = performance.players.find((row) => row.player.entityKey === transferredUserId)!;
    const expectedRounds = first.performance.playerRounds.filter((row) =>
      row.playerEntityKey === transferredUserId && row.teamEntityKey === linkedEntryId
    );

    expect(player).toBeDefined();
    expect(player.teamEntityKeys).toEqual([longTeamId]);
    expect(player.slices.overall.kast.attempts).toBe(expectedRounds.length);
    expect(projected[1]!.facts.performance.playerRounds.some((row) => row.playerEntityKey === transferredUserId)).toBe(false);
    expect(projected[1]!.facts.performance.playerWeapons.some((row) => row.playerEntityKey === transferredUserId)).toBe(false);
  });
});
