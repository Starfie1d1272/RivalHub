import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRivalHubDemoEvidenceV1, rivalHubDemoEvidenceV1Schema, type RivalHubDemoEvidenceV1 } from "@/lib/demo-evidence/contract";
import { rivalHubDemoEvidenceV1SchemaPath, serializeRivalHubDemoEvidenceV1JsonSchema } from "../../../scripts/demo-evidence/generate-json-schema";

const fixturePath = resolve(process.cwd(), "tests/fixtures/demo-evidence/normal-map-v1.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as unknown;
const overtimeFixture = JSON.parse(readFileSync(resolve(process.cwd(), "tests/fixtures/demo-evidence/overtime-map-v1.json"), "utf8")) as unknown;

function cloneFixture(): RivalHubDemoEvidenceV1 {
  return structuredClone(parseRivalHubDemoEvidenceV1(fixture));
}

describe("RivalHubDemoEvidenceV1", () => {
  it("keeps the checked-in JSON Schema in lockstep with the Zod contract", () => {
    expect(readFileSync(rivalHubDemoEvidenceV1SchemaPath, "utf8")).toBe(serializeRivalHubDemoEvidenceV1JsonSchema());
  });

  it("accepts the real normal-map golden fixture and cross-checks its summaries", () => {
    const evidence = parseRivalHubDemoEvidenceV1(fixture);
    expect(evidence.contract).toEqual({
      contractVersion: "rivalhub-demo-evidence/1",
      semanticProfile: "dak-stable/1",
      analysisVersion: "cs2-demo-analysis-kit/1.0",
    });
    expect(evidence.source.producerVersion).toBe("cs2dak-rivalhub-evidence/0.1.0");
    expect(evidence.sourceFacts.rounds).toHaveLength(22);
    expect(evidence.semanticFacts.playerRounds).toHaveLength(220);
  });

  it("keeps the real 16:19 overtime map continuous across regulation and overtime", () => {
    const evidence = parseRivalHubDemoEvidenceV1(overtimeFixture);
    const rounds = evidence.sourceFacts.rounds;
    expect(rounds).toHaveLength(35);
    expect(rounds.map((round) => round.roundSeq)).toEqual(Array.from({ length: 35 }, (_, index) => index + 1));
    expect(rounds.slice(0, 24).every((round) => round.phase === "regulation")).toBe(true);
    expect(rounds.slice(24).every((round) => round.phase === "overtime")).toBe(true);
    expect(rounds[23]).toMatchObject({ roundSeq: 24, teamAScoreBefore: 12, teamBScoreBefore: 11, winnerTeamKey: "teamB" });
    expect(rounds[24]).toMatchObject({ roundSeq: 25, phase: "overtime", teamASide: "ct", teamBSide: "t", teamAScoreBefore: 12, teamBScoreBefore: 12 });
    expect(rounds[27]).toMatchObject({ roundSeq: 28, teamASide: "t", teamBSide: "ct" });

    let scoreA = 0;
    let scoreB = 0;
    for (const round of rounds) {
      expect([round.teamAScoreBefore, round.teamBScoreBefore]).toEqual([scoreA, scoreB]);
      if (round.winnerTeamKey === "teamA") scoreA += 1;
      else scoreB += 1;
    }
    expect([scoreA, scoreB]).toEqual([16, 19]);
    expect(rounds.at(-1)).toMatchObject({ roundSeq: 35, teamASide: "ct", teamBSide: "t", teamAScoreBefore: 16, teamBScoreBefore: 18, winnerTeamKey: "teamB", winnerSide: "t" });
  });

  it("preserves zero, null, and optional-missing semantics", () => {
    const evidence = cloneFixture();
    const zeroUtility = evidence.semanticFacts.playerRounds.find((row) => row.utility.flashesThrown === 0 && row.utility.heDamage === 0);
    expect(zeroUtility).toBeDefined();
    if (!zeroUtility) throw new Error("fixture must include a zero-utility player round");
    expect(zeroUtility.utility).toMatchObject({ flashesThrown: 0, heDamage: 0, utilityKills: 0 });
    expect(evidence.semanticFacts.playerRounds.some((row) => row.clutch === null)).toBe(true);

    delete evidence.target.stageRunId;
    expect(parseRivalHubDemoEvidenceV1(evidence).target.stageRunId).toBeUndefined();
  });

  it("requires the semantic profile and rejects target / identity mismatches", () => {
    const missingProfile = cloneFixture() as unknown as { contract: Record<string, unknown> };
    delete missingProfile.contract.semanticProfile;
    expect(rivalHubDemoEvidenceV1Schema.safeParse(missingProfile).success).toBe(false);

    const wrongEntry = cloneFixture();
    const matched = wrongEntry.participants.find((participant) => participant.resolution.status === "matched");
    if (!matched || matched.resolution.status !== "matched") throw new Error("fixture must include a matched participant");
    matched.resolution.entryId = "40000000-0000-4000-8000-000000000001";
    expect(() => parseRivalHubDemoEvidenceV1(wrongEntry)).toThrow("entryId 必须属于 evidence target");
  });

  it("rejects broken event references and summary drift", () => {
    const invalidKill = cloneFixture();
    invalidKill.sourceFacts.kills[0]!.victimSteamId64 = "76561198000999999";
    expect(() => parseRivalHubDemoEvidenceV1(invalidKill)).toThrow("kill 引用了未知 round 或 participant");

    const drift = cloneFixture();
    drift.summaries.playerMaps[0]!.kills += 1;
    expect(() => parseRivalHubDemoEvidenceV1(drift)).toThrow("playerMaps 与 playerRounds 不一致");

    const multiKillDrift = cloneFixture();
    multiKillDrift.summaries.playerMaps[0]!.twoKillRounds += 1;
    expect(() => parseRivalHubDemoEvidenceV1(multiKillDrift)).toThrow("playerMaps 与 playerRounds 不一致");

    const conversionDrift = cloneFixture();
    conversionDrift.semanticFacts.teamConversions[1]!.teamKey = "teamA";
    expect(() => parseRivalHubDemoEvidenceV1(conversionDrift)).toThrow("teamConversions 必须恰好覆盖双方各一次");

    const advantageDrift = cloneFixture();
    advantageDrift.semanticFacts.teamConversions[0]!.manAdvantage[3]!.advantage = "5v3";
    expect(() => parseRivalHubDemoEvidenceV1(advantageDrift)).toThrow("manAdvantage 必须恰好覆盖四种状态各一次");
  });
});
