import { describe, expect, it } from "vitest";
import { validateCompetitionDefinition } from "@/lib/competition/definition";
import type { PlayerType, StagePlan } from "@/types/season";

const baseStage = {
  key: "rr",
  name: "循环赛",
  type: "round_robin" as const,
  teamCount: 8,
  advanceTiers: [{ placement: "*", count: 2 }],
  matchFormat: "bo1" as const,
};

function capabilities(stagePlan: StagePlan) {
  return {
    stagePlan,
    positions: ["igl", "awper", "opener", "closer", "anchor"],
    registrationConfig: {
      allowedPlayerTypes: ["enrolled", "graduated"] as PlayerType[],
      rankThreshold: { currentMin: null, peakMin: null },
      maxPerPosition: 10,
      screenshotCount: 1,
      maxTotal: 128,
      mapPool: ["de_mirage", "de_inferno", "de_nuke"],
    },
    minTeamSize: 5,
    maxTeamSize: 9,
    starterCount: 5,
  };
}

describe("custom competition definition validation", () => {
  it("refuses publishing a definition whose stage has no active executor (swiss)", () => {
    const issues = validateCompetitionDefinition(capabilities([
      { ...baseStage, type: "swiss", key: "swiss-1", name: "瑞士轮" },
    ]));
    expect(issues.some((issue) => issue.message.includes("自定义赛事当前支持循环赛、单败淘汰和双败淘汰"))).toBe(true);
  });

  it("computes grouped round-robin qualification as tier.count × groupCount", () => {
    // 4 groups × 4 teams; top 2 of each group advance → 8 into elimination.
    const issues = validateCompetitionDefinition(capabilities([
      { ...baseStage, teamCount: 16, groupCount: 4, advanceTiers: [{ placement: "*", count: 2 }] },
      { ...baseStage, key: "elim", name: "淘汰赛", type: "single_elim", teamCount: 8, advanceTiers: [{ placement: "1st", count: 1 }], matchFormat: "bo3" },
    ]));
    expect(issues).toEqual([]);
  });

  it("multiplies only by the explicit groupCount (undefined counts as a single group)", () => {
    const issues = validateCompetitionDefinition(capabilities([
      { ...baseStage, groupCount: 1, advanceTiers: [{ placement: "*", count: 8 }] },
      { ...baseStage, key: "elim", name: "淘汰赛", type: "single_elim", teamCount: 8, advanceTiers: [{ placement: "1st", count: 1 }], matchFormat: "bo3" },
    ]));
    expect(issues).toEqual([]);
  });

  it("refuses a stage transition whose qualified count does not match the next teamCount", () => {
    const issues = validateCompetitionDefinition(capabilities([
      { ...baseStage, advanceTiers: [{ placement: "*", count: 4 }] },
      { ...baseStage, key: "elim", name: "淘汰赛", type: "single_elim", teamCount: 8, advanceTiers: [{ placement: "1st", count: 1 }], matchFormat: "bo3" },
    ]));
    expect(issues.some((issue) => issue.message.includes("参赛人数不一致"))).toBe(true);
  });

  it("refuses a single elimination stage whose teamCount is not a power of two", () => {
    const issues = validateCompetitionDefinition(capabilities([
      { ...baseStage, key: "elim", name: "淘汰赛", type: "single_elim", teamCount: 6, advanceTiers: [{ placement: "1st", count: 1 }], matchFormat: "bo3" },
    ]));
    expect(issues.some((issue) => issue.message.includes("2 的幂"))).toBe(true);
  });

  it("accepts a fully valid grouped round-robin into elimination definition", () => {
    const issues = validateCompetitionDefinition(capabilities([
      { ...baseStage, teamCount: 8, groupCount: 2, advanceTiers: [{ placement: "*", count: 2 }] },
      { ...baseStage, key: "elim", name: "淘汰赛", type: "double_elim", teamCount: 4, advanceTiers: [{ placement: "1st", count: 1 }], matchFormat: "bo3", finalFormat: "bo5" },
    ]));
    expect(issues).toEqual([]);
  });
});
