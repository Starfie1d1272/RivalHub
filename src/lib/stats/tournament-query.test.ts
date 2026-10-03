import { describe, expect, it } from "vitest";
import { collectTournamentPerformanceMapProjection, buildTournamentPerformanceAnalyticsFromProjections } from "@cs2dak/tournament";
import normal from "../../../tests/fixtures/demo-evidence/normal-map-v1.json";
import overtime from "../../../tests/fixtures/demo-evidence/overtime-map-v1.json";
import { parseRivalHubDemoEvidenceV1 } from "@/lib/demo-evidence/contract";
import { adaptStatsEvidence } from "./evidence-adapter";
import { buildCompetitionEntryPerformanceProjection, buildLongTeamPerformanceProjection, scopePerformanceFactsToTeam } from "./tournament-query";

describe("team performance fact scoping", () => {
  it("keeps a transferred player's advanced facts only for the represented team", () => {
    const evidence = parseRivalHubDemoEvidenceV1(normal);
    const bindings = new Map(evidence.participants.map((row, index) => [row.steamId64, {
      userId: `player-${index}`,
      entryId: row.observedTeamKey === "teamA" ? evidence.target.entryAId : evidence.target.entryBId,
    }]));
    const facts = adaptStatsEvidence(evidence, bindings);
    const scoped = scopePerformanceFactsToTeam(collectTournamentPerformanceMapProjection(facts.performance), evidence.target.entryAId);
    const result = buildTournamentPerformanceAnalyticsFromProjections([scoped]);
    expect(result.players).toHaveLength(5);
    expect(result.players.every((row) => row.teamEntityKeys.every((team) => team === evidence.target.entryAId))).toBe(true);

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

    const projection = buildLongTeamPerformanceProjection([
      { importId: "first", facts: { ...first, performance: collectTournamentPerformanceMapProjection(first.performance) } },
      { importId: "second", facts: { ...second, performance: collectTournamentPerformanceMapProjection(second.performance) } },
    ] as Parameters<typeof buildLongTeamPerformanceProjection>[0], new Set([linkedEntryId]), longTeamId);

    const player = projection.detailedPlayers.find((row) => row.player.entityKey === transferredUserId)!;
    const expectedRounds = first.performance.playerRounds.filter((row) =>
      row.playerEntityKey === transferredUserId && row.teamEntityKey === linkedEntryId
    );

    expect(projection.teamPerformance?.team.entityKey).toBe(longTeamId);
    expect(player).toBeDefined();
    expect(player.teamEntityKeys).toEqual([longTeamId]);
    expect(player.slices.overall.kast.attempts).toBe(expectedRounds.length);
    expect(projection.detailedPlayers.some((row) => row.player.entityKey === `opponent:${secondTeamB}:${transferredUserId}`)).toBe(false);
  });
});


describe("competition-entry transferred-player projection", () => {
  it("keeps both sides for DAK while isolating an opponent who previously represented the entry", () => {
    const firstEvidence = parseRivalHubDemoEvidenceV1(normal);
    const secondEvidence = parseRivalHubDemoEvidenceV1(overtime);
    const entryId = firstEvidence.target.entryAId;
    const transferredUserId = "transferred-player";

    const firstBindings = new Map(firstEvidence.participants.map((row, index) => [
      row.steamId64,
      {
        userId: index === 0 ? transferredUserId : `event-first-${index}`,
        entryId: row.observedTeamKey === "teamA" ? entryId : firstEvidence.target.entryBId,
      },
    ]));
    const secondTeamB = secondEvidence.target.entryBId;
    const transferredSteamId = secondEvidence.participants.find((row) => row.observedTeamKey === "teamB")!.steamId64;
    const secondBindings = new Map(secondEvidence.participants.map((row, index) => [
      row.steamId64,
      {
        userId: row.steamId64 === transferredSteamId ? transferredUserId : `event-second-${index}`,
        entryId: row.observedTeamKey === "teamA" ? entryId : secondTeamB,
      },
    ]));

    const first = adaptStatsEvidence(firstEvidence, firstBindings);
    const second = adaptStatsEvidence(secondEvidence, secondBindings);
    second.tournament.mapKey = "event-transfer-map";
    second.performance.mapKey = "event-transfer-map";

    const projection = buildCompetitionEntryPerformanceProjection([
      { importId: "event-first", facts: { ...first, performance: collectTournamentPerformanceMapProjection(first.performance) } },
      { importId: "event-second", facts: { ...second, performance: collectTournamentPerformanceMapProjection(second.performance) } },
    ] as Parameters<typeof buildCompetitionEntryPerformanceProjection>[0], entryId);

    const player = projection.detailedPlayers.find((row) => row.player.entityKey === transferredUserId)!;
    const expectedRounds = first.performance.playerRounds.filter((row) =>
      row.playerEntityKey === transferredUserId && row.teamEntityKey === entryId
    );

    expect(projection.teamPerformance?.team.entityKey).toBe(entryId);
    expect(player).toBeDefined();
    expect(player.teamEntityKeys).toEqual([entryId]);
    expect(player.slices.overall.kast.attempts).toBe(expectedRounds.length);
    expect(projection.detailedPlayers.some((row) => row.player.entityKey === `opponent:${secondTeamB}:${transferredUserId}`)).toBe(false);
  });
});
