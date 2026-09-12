import { describe, expect, it } from "vitest";
import { buildPublicStagePresentation } from "@/lib/seasons/public-stage";

const stagePlan = [
  { key: "stage1", name: "第一阶段", type: "swiss" as const, teamCount: 16, matchFormat: "bo1" as const, advanceTiers: [] },
  { key: "playoff", name: "淘汰赛", type: "single_elim" as const, teamCount: 8, matchFormat: "bo3" as const, finalFormat: "bo5" as const, advanceTiers: [] },
];

describe("public stage presentation", () => {
  it("uses actual initialized event stages instead of lifecycle status", () => {
    const result = buildPublicStagePresentation(
      { id: "season-1", competitionTemplate: "major", stagePlan },
      [],
      ["stage1"],
    );

    expect(result.currentStageKey).toBe("stage1");
    expect(result.currentStageLabel).toBe("STAGE1");
    expect(result.labels.playoff).toBe("PLAYOFF");
  });

  it("uses the frozen Major plan once a StageRun exists", () => {
    const frozenPlan = [
      { ...stagePlan[0], name: "Frozen Stage 1", finalFormat: null },
      stagePlan[1],
    ];
    const result = buildPublicStagePresentation(
      { id: "season-1", competitionTemplate: "major", stagePlan },
      [{ stageKey: "stage1", ruleSnapshot: { version: 4, stagePlan: frozenPlan, rosterRules: { minTeamSize: 5, maxTeamSize: 5, starterCount: 5 }, affiliationRules: [], competitiveProfile: null, frozenCompetitiveFacts: [], runOptions: {} } }],
      ["stage1"],
    );

    expect(result.stagePlan[0]?.name).toBe("Frozen Stage 1");
    expect(result.currentStageLabel).toBe("STAGE1");
  });
});
