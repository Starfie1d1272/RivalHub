import { describe, expect, it } from "vitest";
import { buildMajorRuntimeData } from "@/lib/admin/major-runtime";

const stagePlan = [
  { key: "stage1", name: "阶段一", type: "swiss" as const, teamCount: 16, advanceTiers: [] },
  { key: "playoff", name: "淘汰赛", type: "single_elim" as const, teamCount: 8, advanceTiers: [] },
];

describe("buildMajorRuntimeData", () => {
  it("keeps the active Swiss round in the matches workspace read-model", () => {
    const { swissRuntime, playoffRuntime } = buildMajorRuntimeData({
      seasonId: "season-1",
      stagePlan,
      stageRuns: [{ id: "run-swiss", stageKey: "stage1", finalizedRound: 1 }],
      matches: [
        { majorStageRunId: "run-swiss", ownership: "major_stage", round: 2, entryRound: null, status: "finished" },
        { majorStageRunId: "run-swiss", ownership: "major_stage", round: 2, entryRound: null, status: "scheduled" },
      ],
      finalResultStatus: null,
    });

    expect(playoffRuntime).toBeNull();
    expect(swissRuntime).toMatchObject({
      stageRunId: "run-swiss",
      currentRound: 2,
      currentMatchCount: 2,
      completedMatchCount: 1,
      stageComplete: false,
    });
  });

  it("exposes playoff round progress and respects pending final confirmation", () => {
    const matches = [
      ...Array.from({ length: 4 }, () => ({ majorStageRunId: "run-playoff", ownership: "major_stage", round: null, entryRound: "quarterfinal", status: "finished" })),
      { majorStageRunId: "run-playoff", ownership: "major_stage", round: null, entryRound: "semifinal", status: "finished" },
      { majorStageRunId: "run-playoff", ownership: "major_stage", round: null, entryRound: "semifinal", status: "scheduled" },
    ];

    const active = buildMajorRuntimeData({
      seasonId: "season-1",
      stagePlan,
      stageRuns: [{ id: "run-playoff", stageKey: "playoff", finalizedRound: 0 }],
      matches,
      finalResultStatus: null,
    });
    expect(active.swissRuntime).toBeNull();
    expect(active.playoffRuntime).toMatchObject({ currentRound: "semifinal", currentMatchCount: 2, completedMatchCount: 1 });

    const pending = buildMajorRuntimeData({
      seasonId: "season-1",
      stagePlan,
      stageRuns: [{ id: "run-playoff", stageKey: "playoff", finalizedRound: 0 }],
      matches,
      finalResultStatus: "pending_confirmation",
    });
    expect(pending.playoffRuntime).toMatchObject({ currentRound: null, currentMatchCount: 0, resultPendingConfirmation: true });
  });
});
