import { describe, expect, it, vi } from "vitest";
vi.mock("@/db/client", () => ({ db: {} }));
import { buildPublicStagePresentation } from "@/lib/seasons/public-stage";
import type { StagePlan } from "@/types/season";
const mainPlan: StagePlan = [{ key: "stage-1", name: "Stage 1", type: "swiss", teamCount: 16, matchFormat: "bo1", finalFormat: undefined, advanceTiers: [] }];
const season = { id: "event", competitionTemplate: "major" as const, stagePlan: mainPlan };
const qualification = { format: "short_swiss_2w2l" as const, playInEntryCount: 8, qualifierCount: 4, startedAt: null, completedAt: null };
describe("stage identity across independent runs", () => {
  it("includes configured qualification but does not claim it has started", () => {
    const view = buildPublicStagePresentation(season, [], [], qualification);
    expect(view.stagePlan).toEqual(mainPlan);
    expect(view.officialStages.map((stage) => stage.key)).toEqual(["play-in", "stage-1"]);
    expect(view.currentStageKey).toBeNull();
  });
  it("uses the qualification run until a frozen main StageRun owns the current stage", () => {
    const running = { ...qualification, startedAt: new Date("2026-10-01") };
    const playIn = buildPublicStagePresentation(season, [], ["play-in"], running);
    expect(playIn).toMatchObject({ currentStageKey: "play-in", currentStageLabel: "Play-in", labels: { "play-in": "Play-in" } });
    const ruleSnapshot = { version: 4, stagePlan: mainPlan.map((stage) => ({ ...stage, finalFormat: null })), rosterRules: { minTeamSize: 5, maxTeamSize: 9, starterCount: 5 }, affiliationRules: [], competitiveProfile: null, frozenCompetitiveFacts: [], runOptions: {} };
    const main = buildPublicStagePresentation({ ...season, stagePlan: [] }, [{ stageKey: "stage-1", ruleSnapshot, startedAt: new Date("2026-10-02") }], ["play-in", "stage-1"], running);
    expect(main.stagePlan).toEqual([{ ...mainPlan[0], finalFormat: null }]);
    expect(main.currentStageKey).toBe("stage-1");
    expect(main.officialStages.map((stage) => stage.key)).toEqual(["play-in", "stage-1"]);
  });
});
