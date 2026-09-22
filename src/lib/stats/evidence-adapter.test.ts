import { describe, expect, it } from "vitest";
import { buildTournamentAnalytics, buildTournamentPerformanceAnalytics } from "@cs2dak/tournament";
import normal from "../../../tests/fixtures/demo-evidence/normal-map-v1.json";
import overtime from "../../../tests/fixtures/demo-evidence/overtime-map-v1.json";
import { parseRivalHubDemoEvidenceV1 } from "@/lib/demo-evidence/contract";
import { adaptStatsEvidence } from "./evidence-adapter";

function adapt(input: unknown) {
  const evidence = parseRivalHubDemoEvidenceV1(input);
  const bindings = new Map(evidence.participants.map((row, index) => [row.steamId64, { userId: `canonical-${index}`, entryId: evidence.target[row.observedTeamKey === "teamA" ? "entryAId" : "entryBId"] }]));
  return adaptStatsEvidence(evidence, bindings);
}
describe("tournament frozen evidence adapter", () => {
  it("aggregates Player, Team and Map with canonical identity and additive denominators", () => {
    const second = adapt(overtime);
    // The two immutable fixtures share a target; bind a distinct test map identity.
    second.tournament.mapKey = "overtime-map";
    second.performance.mapKey = "overtime-map";
    const facts = [adapt(normal), second];
    const analytics = buildTournamentAnalytics(facts.map((row) => row.tournament));
    const performance = buildTournamentPerformanceAnalytics(facts.map((row) => row.performance));
    expect(analytics.totals.mapCount).toBe(2);
    expect(analytics.totals.roundCount).toBe(normal.sourceFacts.rounds.length + overtime.sourceFacts.rounds.length);
    expect(performance.players[0].player.entityKey).toMatch(/^canonical-/);
    expect(analytics.teams[0].team.entityKey).toBe(normal.target.entryAId);
    const player = performance.players.find((row) => row.player.entityKey === "canonical-0")!;
    const rounds = facts.flatMap((row) => row.performance.playerRounds).filter((row) => row.playerEntityKey === "canonical-0");
    expect(player.slices.overall.kast).toEqual({ successes: rounds.filter((row) => row.kast).length, attempts: rounds.length, rate: rounds.filter((row) => row.kast).length / rounds.length });
    expect(performance.maps.length).toBeGreaterThan(0);
  });
  it("keeps zero-opportunity rates null", () => {
    const facts = adapt(normal);
    for (const row of facts.performance.playerRounds) row.clutch = null;
    const result = buildTournamentPerformanceAnalytics([facts.performance]);
    expect(result.players.every((row) => row.slices.overall.clutch.winRate.rate === null)).toBe(true);
  });
  it("rejects retired profiles and missing identity, ignoring client resolution claims", () => {
    const evidence = parseRivalHubDemoEvidenceV1(normal);
    expect(() => adaptStatsEvidence(evidence, new Map())).toThrow(/identity/);
    expect(() => adapt({ ...normal, contract: { ...normal.contract, semanticProfile: "dak-stable/2" } })).toThrow(/profile/);
    const forged = structuredClone(normal);
    forged.participants.forEach((row) => { row.nameSnapshot = "same nickname"; });
    expect(buildTournamentPerformanceAnalytics([adapt(forged).performance]).players).toHaveLength(normal.participants.length);
  });
});
