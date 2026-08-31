import { describe, expect, it } from "vitest";
import { resolveMatchLineupPolicy } from "@/lib/match-rosters/policy";

const v4Snapshot = {
  version: 4,
  stagePlan: [{ key: "stage-1", name: "Stage 1", type: "swiss", teamCount: 16, matchFormat: "bo1", finalFormat: null, advanceTiers: [] }],
  rosterRules: { minTeamSize: 5, maxTeamSize: 9, starterCount: 6 },
  affiliationRules: [],
  competitiveProfile: null,
  frozenCompetitiveFacts: [],
  runOptions: {},
};

describe("resolveMatchLineupPolicy", () => {
  it("reads Major starter count only from the frozen StageRun snapshot", () => {
    expect(resolveMatchLineupPolicy({
      ownership: "major_stage",
      seasonStarterCount: 5,
      majorStageRun: { stageKey: "stage-1", ruleSnapshot: v4Snapshot },
    })).toEqual({ starterCount: 6, maxSubstitutes: 0 });
  });

  it("uses the published season policy for non-Major matches", () => {
    expect(resolveMatchLineupPolicy({ ownership: "manual", seasonStarterCount: 4 }))
      .toEqual({ starterCount: 4, maxSubstitutes: 2 });
  });
});
