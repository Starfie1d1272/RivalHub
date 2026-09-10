import { describe, expect, it } from "vitest";
import { MAJOR_STAGE_PLAN, RIVALS_STAGE_PLAN } from "@/lib/competition/templates";
import { buildStageViews, resolveDefaultStageKey } from "./stage-views";
import { resolveStrictHistoricalRoundRobinEntryIds } from "./historical-round-robin";
import { resolveStageTransitionBoundary } from "./stage-transition";

const match = (stage: string, status = "scheduled", entryAId = `${stage}-a`, entryBId = `${stage}-b`) => ({
  stage,
  status,
  entryAId,
  entryBId,
});

describe("stage views", () => {
  it("keeps one view per configured logical stage and reports unknown stages", () => {
    const rows = [match("stage1", "finished"), match("stage2"), match("stage3", "cancelled"), match("playoff"), match("unknown")];
    const { views, unconfiguredMatches } = buildStageViews(MAJOR_STAGE_PLAN, rows);
    expect(views.map(({ stage }) => stage.key)).toEqual(["stage1", "stage2", "stage3", "playoff"]);
    expect(unconfiguredMatches).toEqual([rows[4]]);
  });

  it("resolves the default only from StagePlan keys", () => {
    const rows = [match("stage1"), match("stage3"), match("unknown")];
    expect(resolveDefaultStageKey(MAJOR_STAGE_PLAN, rows)).toBe("stage3");
    expect(resolveDefaultStageKey(MAJOR_STAGE_PLAN, rows, "stage2")).toBe("stage2");
    expect(resolveDefaultStageKey(MAJOR_STAGE_PLAN, rows, "unknown")).toBe("stage3");
    expect(resolveDefaultStageKey(MAJOR_STAGE_PLAN, [])).toBe("stage1");
  });

  it("only recovers historical round-robin entrants when pair coverage is complete", () => {
    const rows = [
      match("qualifier", "finished", "a", "b"),
      match("qualifier", "finished", "a", "c"),
      match("qualifier", "finished", "b", "c"),
    ];
    expect(resolveStrictHistoricalRoundRobinEntryIds(3, rows)).toEqual(["a", "b", "c"]);
    expect(resolveStrictHistoricalRoundRobinEntryIds(3, rows.slice(0, 2))).toBeNull();
    expect(resolveStrictHistoricalRoundRobinEntryIds(3, [...rows, match("qualifier", "finished", "a", "b")])).toBeNull();
  });

  it("resolves generic transition entrants without UI-side adjacent-stage logic", () => {
    const entries = ["a", "b", "c", "d"].map((id, index) => ({ id, formationOrder: index + 1 })) as never[];
    const boundary = resolveStageTransitionBoundary({
      stagePlan: RIVALS_STAGE_PLAN,
      stageKey: "playoff",
      entries,
      qualifiers: [{ teamId: "a", placement: "1st" }, { teamId: "b", placement: "2nd" }],
      previousComplete: true,
    });
    expect(boundary.previousStage?.key).toBe("qualifier");
    expect(boundary.nextStage).toBeNull();
    expect(boundary.stageEntries.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(boundary.readiness).toBe("invalid_entrant_count");
  });
});
