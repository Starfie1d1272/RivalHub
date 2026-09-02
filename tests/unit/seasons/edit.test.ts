import { describe, expect, it } from "vitest";
import { planSeasonUpdate } from "@/lib/seasons/edit";
import { unfreezeBuiltInCompetitiveContext } from "@/lib/seasons/lifecycle";
import { seasonFormSchema } from "@/lib/seasons/edit";
import { createMajorTemplate, createRivalsTemplate } from "@/lib/competition/templates";
import type { SeasonRow } from "@/lib/seasons/edit";

const MAJOR_TEMPLATE = createMajorTemplate();
const RIVALS_TEMPLATE = createRivalsTemplate();

function input(overrides?: Record<string, unknown>) {
  return {
    name: "NJU Major 2026",
    slug: "nju-major-2026",
    kind: "Major",
    template: "major" as const,
    themeColor: "#f97316",
    registrationOpensAt: null,
    registrationOpenedAt: null,
    registrationClosesAt: null,
    rosterChangeClosesAt: null,
    endAt: null,
    registrationMode: "team" as const,
    hasCaptainVoting: false,
    hasDraft: false,
    minTeamSize: 5,
    maxTeamSize: 9,
    starterCount: 5,
    positions: ["igl", "awper", "opener", "closer", "anchor"],
    stagePlan: MAJOR_TEMPLATE.stagePlan,
    registrationConfig: MAJOR_TEMPLATE.registrationConfig,
    teamRegistrationConfig: MAJOR_TEAM_CONFIG_FROZEN,
    affiliationRules: MAJOR_TEMPLATE.affiliationRules,
    ...overrides,
  };
}

const MAJOR_TEAM_CONFIG_FROZEN = {
  ...MAJOR_TEMPLATE.teamRegistrationConfig,
  competitiveProfile: {
    platform: "perfect_world",
    currentSeasonKey: "S20",
    previousSeasonKey: "S21",
    rankOrder: ["D", "C", "B", "A", "S"],
  },
};

function seasonRow(overrides?: Partial<SeasonRow>): SeasonRow {
  const parsed = seasonFormSchema.parse(input()) as Record<string, unknown>;
  return {
    id: "00000000-0000-0000-0000-0000000000aa",
    slug: parsed.slug as string,
    createdAt: new Date(),
    ...parsed,
    status: "draft",
    competitionTemplate: "major",
    ...overrides,
  } as SeasonRow;
}

function parseInput(overrides?: Record<string, unknown>) {
  return seasonFormSchema.parse(input(overrides));
}

describe("planSeasonUpdate template identity", () => {
  it("re-canonicalizes a draft Major even when the client replays the persisted template", () => {
    const tampered = parseInput({
      stagePlan: [{ ...MAJOR_TEMPLATE.stagePlan[0]!, teamCount: 4 }],
      hasDraft: true,
      registrationMode: "solo",
    });
    const { template, set } = planSeasonUpdate(seasonRow(), tampered);
    expect(template).toBe("major");
    expect(set.stagePlan).toEqual(MAJOR_TEMPLATE.stagePlan);
    expect(set.registrationMode).toBe("team");
    expect(set.hasDraft).toBe(false);
  });

  it("a draft Major save canonicalizes tampered team size back to the fixed 5/9/5", () => {
    const parsed = parseInput({ minTeamSize: 6, maxTeamSize: 10, starterCount: 6 });
    const { set } = planSeasonUpdate(seasonRow(), parsed);
    expect(set.minTeamSize).toBe(5);
    expect(set.maxTeamSize).toBe(9);
    expect(set.starterCount).toBe(5);
  });

  it("a draft Rivals save canonicalizes tampered team size back to the fixed 7/7/5", () => {
    const row = seasonRow({ competitionTemplate: "rivals", status: "draft" });
    const parsed = seasonFormSchema.parse({
      ...input({
        template: "rivals",
        kind: "Rivals",
        registrationMode: "solo",
        hasCaptainVoting: true,
        hasDraft: true,
        minTeamSize: 5,
        maxTeamSize: 9,
        starterCount: 6,
        stagePlan: RIVALS_TEMPLATE.stagePlan,
      }),
    });
    const { set } = planSeasonUpdate(row, parsed);
    expect(set.minTeamSize).toBe(7);
    expect(set.maxTeamSize).toBe(7);
    expect(set.starterCount).toBe(5);
  });

  it("a draft custom season shaped exactly like Rivals stays custom with its own input", () => {
    const row = seasonRow({ competitionTemplate: "custom", status: "draft" });
    const parsed = seasonFormSchema.parse({
      ...input({
        template: "custom",
        kind: "Rivals",
        registrationMode: "solo",
        hasCaptainVoting: true,
        hasDraft: true,
        stagePlan: RIVALS_TEMPLATE.stagePlan,
        minTeamSize: 7,
        maxTeamSize: 7,
      }),
    });
    const { template, set } = planSeasonUpdate(row, parsed);
    expect(template).toBe("custom");
    expect(set.stagePlan).toEqual(RIVALS_TEMPLATE.stagePlan);
    expect(set.registrationMode).toBe("solo");
    expect(set.hasDraft).toBe(true);
  });

  it("a non-draft metadata edit only writes metadata and never touches the frozen competitive context", () => {
    const row = seasonRow({ status: "registration" });
    const parsed = parseInput({ name: "Renamed Major", themeColor: "#112233" });
    const { template, set } = planSeasonUpdate(row, parsed);
    expect(template).toBe("major");
    expect(set.name).toBe("Renamed Major");
    expect(set).not.toHaveProperty("stagePlan");
    expect(set).not.toHaveProperty("teamRegistrationConfig");
    expect(set).not.toHaveProperty("registrationConfig");
  });

  it("a non-draft core change is refused", () => {
    const row = seasonRow({ status: "registration" });
    const parsed = parseInput({ maxTeamSize: 12 });
    expect(() => planSeasonUpdate(row, parsed)).toThrowError(/只有 draft 状态可修改核心赛季配置/);
  });

  it("a non-draft template switch is refused", () => {
    const row = seasonRow({ status: "registration" });
    const parsed = parseInput({ template: "rivals" });
    expect(() => planSeasonUpdate(row, parsed)).toThrowError(/只有 draft 状态可切换赛事体系/);
  });
});

describe("unfreezeBuiltInCompetitiveContext", () => {
  it("resets a published Major's frozen catalog context back to the draft template context", () => {
    const result = unfreezeBuiltInCompetitiveContext({
      competitionTemplate: "major",
      teamRegistrationConfig: MAJOR_TEAM_CONFIG_FROZEN,
    });
    expect(result?.requireCompetitiveProfile).toBe(true);
    expect(result?.competitiveProfile).toEqual({
      platform: "perfect_world",
      currentSeasonKey: "",
      previousSeasonKey: "",
      rankOrder: [],
    });
  });

  it("leaves custom seasons untouched", () => {
    const result = unfreezeBuiltInCompetitiveContext({
      competitionTemplate: "custom",
      teamRegistrationConfig: MAJOR_TEAM_CONFIG_FROZEN,
    });
    expect(result).toBeNull();
  });

  it("does not change seasons without a competitive profile requirement", () => {
    const config = { ...createMajorTemplate().teamRegistrationConfig, requireCompetitiveProfile: false };
    expect(unfreezeBuiltInCompetitiveContext({ competitionTemplate: "major", teamRegistrationConfig: config })).toBeNull();
  });
});
