import { describe, expect, it } from "vitest";
import { buildOfficialStageDirectory, isOfficialStageKey, type QualificationStageFact } from "@/lib/seasons/official-stages";
import { projectOfficialStage } from "@/lib/demo-integration/stage-projection";
import { rivalHubEventsResponseSchema } from "@/lib/demo-integration/contracts";
import { showStats } from "@/lib/utils/season";
import { selectFeaturedSeason } from "@/lib/home/navigation";
import type { StagePlan } from "@/types/season";

const mainPlan: StagePlan = [{ key: "stage-1", name: "正赛", type: "swiss", teamCount: 16, matchFormat: "bo1", advanceTiers: [] }];
const run: QualificationStageFact = { format: "direct_bo3", playInEntryCount: 8, qualifierCount: 4, startedAt: null, completedAt: null };

describe("official stage directory and consumer scope", () => {
  // Protects corpus identity and transport compatibility, not property-by-property implementation.
  it("keeps configured, qualification and legacy identities without altering the main plan", () => {
    const directory = buildOfficialStageDirectory(mainPlan, run, ["play-in", "legacy-stage", "legacy-stage"]);
    expect(directory.map((stage) => stage.key)).toEqual(["play-in", "stage-1", "legacy-stage"]);
    expect(mainPlan.map((stage) => stage.key)).toEqual(["stage-1"]);
    expect(directory.at(-1)).toMatchObject({ source: "historical", config: null, qualification: null });
    expect(isOfficialStageKey(directory, "legacy-stage")).toBe(true);
    expect(isOfficialStageKey(directory, "typo")).toBe(false);
    expect(buildOfficialStageDirectory(mainPlan).map((stage) => stage.key)).toEqual(["stage-1"]);
    expect(buildOfficialStageDirectory([], null, ["play-in"])[0]).toMatchObject({ key: "play-in", config: null });
  });

  it.each([ ["direct_bo3", "single_elim", "bo3"], ["short_swiss_2w2l", "swiss", "bo1"] ] as const)(
    "describes %s in the unchanged DAK v1 contract without pretending it is a Major rule snapshot", (format, type, matchFormat) => {
      const [stage] = buildOfficialStageDirectory(mainPlan, { ...run, format });
      const projected = projectOfficialStage(stage!);
      expect(projected).toEqual({ key: "play-in", name: "Play-in", type, matchFormat, finalFormat: null, teamCount: 8, advanceCount: 4 });
      expect(rivalHubEventsResponseSchema.safeParse({ contractVersion: "rivalhub-dak-events/1", generatedAt: new Date().toISOString(), events: [{
        id: "10000000-0000-4000-8000-000000000001", seasonId: "10000000-0000-4000-8000-000000000001", slug: "qualifier", name: "Qualifier", kind: "major", revision: "test", stages: [projected], teams: [], series: [],
      }] }).success).toBe(true);
    },
  );

  it("does not fabricate a DAK tournament rule for an orphan historic key", () => {
    expect(projectOfficialStage(buildOfficialStageDirectory([], null, ["orphan"])[0]!)).toBeNull();
  });

  it("opens stats and discovery from official facts, excluding unpublished events and test-only samples", () => {
    expect(showStats({ status: "registration", hasOfficialMatches: true })).toBe(true);
    expect(showStats({ status: "registration", hasOfficialMatches: false })).toBe(false);
    expect(showStats({ status: "draft", hasOfficialMatches: true })).toBe(false);
    expect(showStats({ status: "archived" })).toBe(true);
    expect(selectFeaturedSeason([
      { id: "qualifier", status: "registration", hasOfficialMatches: true },
      { id: "voting", status: "voting" },
    ])?.id).toBe("qualifier");
  });
});
