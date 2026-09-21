import { describe, expect, it } from "vitest";
import { presentResultCorrectionPlan } from "@/lib/match-corrections/presentation";

describe("match correction presentation", () => {
  it("projects structured recovery facts without exposing runtime identifiers", () => {
    const view = presentResultCorrectionPlan({
      matchId: "internal-match-id",
      stageKey: "internal-playoff-stage",
      stageType: "swiss",
      current: { scoreA: 0, scoreB: 1, isForfeit: false },
      proposed: { scoreA: 1, scoreB: 0, isForfeit: false },
      currentWinnerTeamId: "internal-team-b",
      proposedWinnerTeamId: "internal-team-a",
      winnerChanges: true,
      affectsManagedRun: true,
      impacts: [
        {
          kind: "downstream_match",
          matchId: "internal-downstream-match",
          managedKey: "r2-1",
          status: "scheduled",
          invalidatable: true,
          dependencyKnown: true,
        },
        {
          kind: "stage_run_rollback",
          previousFinalizedRound: 3,
          rollbackTo: 1,
          fromRound: 2,
        },
      ],
      blockedReasons: [{ code: "downstreamStageMaterialized", params: { stageKey: "internal-playoff-stage" } }],
      requiredRecoveryActions: [
        { code: "invalidateDownstreamMatches", params: { count: 1 } },
        { code: "rebuildSwissRounds", params: { fromRound: 2 } },
      ],
    });

    expect(view.impacts).toEqual([
      { label: "一场尚未开始的下游比赛将被作废并重建。" },
      { label: "第 2 轮及之后的赛程确认将被撤销。" },
    ]);
    expect(view.requiredRecoveryActions).toEqual([
      "应用更正前，系统会作废 1 场尚未开始的下游比赛。",
      "从第 2 轮开始重新确认赛程，直到后续对阵恢复。",
    ]);
    expect(view.blockedReasons).toEqual([
      "后续阶段已经基于本阶段结果建立，不能自动重建；需要走赛后裁决。",
    ]);
    expect(view).not.toHaveProperty("stageKey");
    expect(JSON.stringify(view)).not.toMatch(/internal-playoff-stage|internal-downstream-match|r2-1|scheduled|finalizedRound|finalize/);
  });
});
