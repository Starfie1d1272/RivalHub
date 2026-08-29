import { describe, expect, it } from "vitest";
import { validateCompetitionDefinition } from "@/lib/competition/definition";
import { createCompetitionTemplate, createMajorTemplate, createRivalsTemplate } from "@/lib/competition/templates";

describe("competition templates", () => {
  it("creates independent canonical Rivals and Major definitions", () => {
    const rivals = createRivalsTemplate();
    const major = createMajorTemplate();
    expect(rivals.registrationMode).toBe("solo");
    expect(rivals.hasDraft).toBe(true);
    expect(major.registrationMode).toBe("team");
    expect(major.stagePlan.map((stage) => stage.matchFormat)).toEqual(["bo1", "bo1", "bo3", "bo3"]);
    expect(major.stagePlan[3]?.finalFormat).toBe("bo5");
    major.positions.pop();
    expect(createCompetitionTemplate("major").positions).toHaveLength(5);
  });

  it("fails closed for incomplete or unsupported custom definitions", () => {
    const custom = createCompetitionTemplate("custom");
    expect(validateCompetitionDefinition(custom)).toEqual(expect.arrayContaining([expect.objectContaining({ path: "stagePlan" })]));
    custom.stagePlan = [{ key: "swiss", name: "瑞士轮", type: "swiss", teamCount: 16, advanceTiers: [], matchFormat: "bo1" }];
    expect(validateCompetitionDefinition(custom)).toEqual(expect.arrayContaining([expect.objectContaining({ message: "自定义赛事当前支持循环赛、单败淘汰和双败淘汰。" })]));
  });
});
