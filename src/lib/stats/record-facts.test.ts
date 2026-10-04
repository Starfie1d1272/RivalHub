import { describe, expect, it } from "vitest";
import { buildTournamentPerformanceAnalyticsFromProjections, collectTournamentPerformanceMapProjection } from "@cs2dak/tournament";
import normal from "../../../tests/fixtures/demo-evidence/normal-map-v1.json";
import overtime from "../../../tests/fixtures/demo-evidence/overtime-map-v1.json";
import { parseRivalHubDemoEvidenceV1, type RivalHubDemoEvidenceV1 } from "@/lib/demo-evidence/contract";
import { adaptStatsEvidence } from "./evidence-adapter";
import { collectRecordFacts } from "./record-facts";
function collect(evidence: RivalHubDemoEvidenceV1) {
  const bindings = new Map(evidence.participants.map((p, i) => [p.steamId64, { userId: `player-${i}`, entryId: p.observedTeamKey === "teamA" ? evidence.target.entryAId : evidence.target.entryBId }]));
  const performance = buildTournamentPerformanceAnalyticsFromProjections([collectTournamentPerformanceMapProjection(adaptStatsEvidence(evidence, bindings).performance)]);
  return { records: collectRecordFacts(evidence, bindings, performance), performance };
}
describe("compact record projection", () => {
  it.each([normal, overtime])("JSON persistence retains canonical full-map values and round provenance", (input) => {
    const evidence = parseRivalHubDemoEvidenceV1(input), { records, performance } = collect(evidence);
    expect(JSON.parse(JSON.stringify(records))).toEqual(records);
    expect(records.equipmentSampling).toBe("freezeEnd");
    expect(records.economyKnownRounds).toBe(evidence.sourceFacts.rounds.length);
    const maxKills = Math.max(...performance.players.map((p) => p.slices.overall.combat.kills));
    expect(records.candidates.filter((c) => c.kind === "kills").every((c) => c.numerator === maxKills)).toBe(true);
    for (const c of records.candidates.filter((c) => c.kind === "adr")) {
      const player = performance.players.find((p) => p.player.entityKey === c.entityId)!;
      expect(c.numerator).toBe(player.slices.overall.combat.damage);
      expect(c.denominator).toBe(evidence.sourceFacts.rounds.length);
    }
    for (const c of records.candidates.filter((c) => c.kind === "clutch")) {
      expect(evidence.semanticFacts.playerRounds.some((r) => r.roundSeq === c.round && r.clutch?.won && r.clutch.opponentCount === c.numerator)).toBe(true);
    }
    expect(JSON.stringify(records)).not.toMatch(/playerRounds|sourceFacts|steamId64|payloadSha256/);
  });
  it("never treats null equipment as zero or an unverified exporter as freeze-end", () => {
    const evidence = parseRivalHubDemoEvidenceV1(normal);
    evidence.semanticFacts.playerRounds[0]!.equipmentValue = null;
    expect(collect(evidence).records.economyKnownRounds).toBe(evidence.sourceFacts.rounds.length - 1);
    evidence.source.exporterVersion = "unknown";
    expect(collect(evidence).records).toMatchObject({ equipmentSampling: "unverified", economyKnownRounds: 0 });
    expect(collect(evidence).records.candidates.some((c) => c.kind === "economy")).toBe(false);
  });
});
