import { describe, expect, it } from "vitest";
import {
  assertVetoSequence,
  legacyVetoStepsToFacts,
  projectVetoMapPlan,
  type LegacyVetoSequenceStep,
  type VetoSequenceStep,
} from "@/lib/matches/veto-sequence";

const TEAM_A = "team-a";
const TEAM_B = "team-b";

function steps(types: VetoSequenceStep["actionType"][], teams: Array<string | null>, finalSide: "ct" | null = "ct"): VetoSequenceStep[] {
  return types.map((actionType, index) => ({ actionType, entryId: teams[index]!, mapName: `map-${index + 1}`, side: index === types.length - 1 ? finalSide : null }));
}

describe("assertVetoSequence", () => {
  it("accepts the complete BO1 sequence with Team B choosing the decider side", () => {
    expect(() => assertVetoSequence("bo1", steps(["ban", "ban", "ban", "ban", "ban", "ban", "decider"], [TEAM_A, TEAM_A, TEAM_B, TEAM_B, TEAM_B, TEAM_A, TEAM_B]), TEAM_A, TEAM_B)).not.toThrow();
  });

  it("accepts the complete BO3 sequence with Team B choosing Map 3's side", () => {
    expect(() => assertVetoSequence("bo3", steps(["ban", "ban", "pick", "pick", "ban", "ban", "decider"], [TEAM_A, TEAM_B, TEAM_A, TEAM_B, TEAM_B, TEAM_A, TEAM_B]), TEAM_A, TEAM_B)).not.toThrow();
  });

  it("accepts the BO5 knife decider with no team side picker", () => {
    expect(() => assertVetoSequence("bo5", steps(["ban", "ban", "pick", "pick", "pick", "pick", "decider"], [TEAM_A, TEAM_B, TEAM_A, TEAM_B, TEAM_A, TEAM_B, null], null), TEAM_A, TEAM_B)).not.toThrow();
    expect(() => assertVetoSequence("bo5", steps(["ban", "ban", "pick", "pick", "pick", "pick", "decider"], [TEAM_A, TEAM_B, TEAM_A, TEAM_B, TEAM_A, TEAM_B, TEAM_B]), TEAM_A, TEAM_B)).toThrow("BO5 BP 操作顺序不合法");
  });

  it("derives VETO A from the first actor even when that team is Entry B", () => {
    const entryBStarts = steps(
      ["ban", "ban", "pick", "pick", "ban", "ban", "decider"],
      [TEAM_B, TEAM_A, TEAM_B, TEAM_A, TEAM_A, TEAM_B, TEAM_A],
    );
    expect(() => assertVetoSequence("bo3", entryBStarts, TEAM_A, TEAM_B)).not.toThrow();
  });

  it("projects post-match pick side facts through the canonical sequence", () => {
    const legacySteps: LegacyVetoSequenceStep[] = [
      { actionType: "ban", mapName: "m1", entryId: TEAM_B },
      { actionType: "ban", mapName: "m2", entryId: TEAM_A },
      { actionType: "pick", mapName: "m3", entryId: TEAM_B, side: "ct" },
      { actionType: "pick", mapName: "m4", entryId: TEAM_A, side: "t" },
      { actionType: "ban", mapName: "m5", entryId: TEAM_A },
      { actionType: "ban", mapName: "m6", entryId: TEAM_B },
      { actionType: "decider", mapName: "m7", entryId: TEAM_A, side: "ct" },
    ];
    const plan = projectVetoMapPlan({
      format: "bo3",
      entryAId: TEAM_A,
      steps: legacyVetoStepsToFacts("bo3", legacySteps, TEAM_A, TEAM_B),
    });
    expect(plan).toMatchObject([
      { mapName: "m3", pickedByEntryId: TEAM_B, teamAStartSide: "ct" },
      { mapName: "m4", pickedByEntryId: TEAM_A, teamAStartSide: "ct" },
      { mapName: "m7", pickedByEntryId: null, teamAStartSide: "ct" },
    ]);
  });

  it("keeps the BO5 fifth-map knife side null in a legacy map-plan projection", () => {
    const legacySteps: LegacyVetoSequenceStep[] = [
      { actionType: "ban", mapName: "m1", entryId: TEAM_A },
      { actionType: "ban", mapName: "m2", entryId: TEAM_B },
      { actionType: "pick", mapName: "m3", entryId: TEAM_A },
      { actionType: "pick", mapName: "m4", entryId: TEAM_B },
      { actionType: "pick", mapName: "m5", entryId: TEAM_A },
      { actionType: "pick", mapName: "m6", entryId: TEAM_B },
      { actionType: "decider", mapName: "m7", entryId: null },
    ];
    const plan = projectVetoMapPlan({
      format: "bo5",
      entryAId: TEAM_A,
      steps: legacyVetoStepsToFacts("bo5", legacySteps, TEAM_A, TEAM_B),
    });
    expect(plan[4]).toMatchObject({ mapName: "m7", teamAStartSide: null });
  });
});
