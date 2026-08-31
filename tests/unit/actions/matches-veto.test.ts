import { describe, expect, it } from "vitest";
import { assertVetoSequence, type VetoSequenceStep } from "@/lib/matches/veto-sequence";

const TEAM_A = "team-a";
const TEAM_B = "team-b";

function steps(types: VetoSequenceStep["actionType"][], teams: Array<string | null>): VetoSequenceStep[] {
  return types.map((actionType, index) => ({ actionType, entryId: teams[index]!, mapName: `map-${index + 1}`, side: index === types.length - 1 ? "ct" : null }));
}

describe("assertVetoSequence", () => {
  it("accepts the complete BO1 sequence with Team B choosing the decider side", () => {
    expect(() => assertVetoSequence("bo1", steps(["ban", "ban", "ban", "ban", "ban", "ban", "decider"], [TEAM_A, TEAM_A, TEAM_B, TEAM_B, TEAM_B, TEAM_A, TEAM_B]), TEAM_A, TEAM_B)).not.toThrow();
  });

  it("accepts the complete BO3 sequence with Team B choosing Map 3's side", () => {
    expect(() => assertVetoSequence("bo3", steps(["ban", "ban", "pick", "pick", "ban", "ban", "decider"], [TEAM_A, TEAM_B, TEAM_A, TEAM_B, TEAM_B, TEAM_A, TEAM_B]), TEAM_A, TEAM_B)).not.toThrow();
  });

  it("accepts the complete BO5 sequence with Team B choosing Map 5's side", () => {
    expect(() => assertVetoSequence("bo5", steps(["ban", "ban", "pick", "pick", "pick", "pick", "decider"], [TEAM_A, TEAM_B, TEAM_A, TEAM_B, TEAM_A, TEAM_B, TEAM_B]), TEAM_A, TEAM_B)).not.toThrow();
  });
});
