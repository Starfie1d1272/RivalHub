import { describe, expect, it } from "vitest";
import { createCompetitionTemplate, createCustomTournamentTemplate, createMajorTemplate, createRivalsTemplate, inferCompetitionTemplate } from "@/lib/competition/templates";
import { isStageExecutorSupported } from "@/lib/formats";
import { resolveCompetitionDefinition, type SeasonFormInput } from "@/lib/seasons/edit";
import type { SeasonCapabilities } from "@/types/season";

function formInput(overrides?: Partial<SeasonFormInput>): SeasonFormInput {
  return {
    name: "Test Season",
    slug: "test-season",
    kind: "联赛",
    themeColor: null,
    startAt: null,
    registrationDeadline: null,
    endAt: null,
    registrationMode: "team",
    hasCaptainVoting: false,
    hasDraft: false,
    minTeamSize: 5,
    maxTeamSize: 9,
    starterCount: 5,
    positions: ["igl", "awper", "opener", "closer", "anchor"],
    stagePlan: [],
    registrationConfig: {
      allowedPlayerTypes: ["enrolled", "graduated"],
      rankThreshold: { currentMin: null, peakMin: null },
      maxPerPosition: 10,
      screenshotCount: 1,
      maxTotal: 128,
      mapPool: ["de_mirage", "de_inferno", "de_nuke"],
    },
    ...overrides,
  };
}

describe("competition templates", () => {
  it("Rivals draft-league preset is solo + captain voting + draft with the Rivals stage plan", () => {
    const capabilities: SeasonCapabilities = createRivalsTemplate();
    expect(capabilities.registrationMode).toBe("solo");
    expect(capabilities.hasCaptainVoting).toBe(true);
    expect(capabilities.hasDraft).toBe(true);
    expect(capabilities.stagePlan.map((stage) => stage.type)).toEqual(["round_robin", "double_elim"]);
    expect(inferCompetitionTemplate(capabilities)).toBe("rivals");
  });

  it("Major preset passes the standard Major capability check and infers as major", async () => {
    const { checkStandardMajorCapabilities } = await import("@/types/season");
    const capabilities = createMajorTemplate();
    expect(checkStandardMajorCapabilities(capabilities).isStandardMajor).toBe(true);
    expect(inferCompetitionTemplate(capabilities)).toBe("major");
  });

  it("custom tournament starts from an empty executable contract", () => {
    const capabilities = createCustomTournamentTemplate();
    expect(capabilities.stagePlan).toEqual([]);
    expect(capabilities.hasDraft).toBe(false);
  });

  it("createCompetitionTemplate returns an independent clone per call", () => {
    const a = createCompetitionTemplate("major");
    const b = createCompetitionTemplate("major");
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    a.stagePlan.pop();
    expect(b.stagePlan).toHaveLength(4);
  });
});

describe("resolveCompetitionDefinition (draft canonicalization)", () => {
  it("a custom draft whose shape mimics Rivals keeps custom identity and input", () => {
    const rivalsLike = formInput({
      template: "custom",
      registrationMode: "solo",
      hasCaptainVoting: true,
      hasDraft: true,
      kind: "Rivals",
      stagePlan: createRivalsTemplate().stagePlan,
    });
    const data = resolveCompetitionDefinition(rivalsLike as never, true);
    expect(data.registrationMode).toBe("solo");
    expect(data.hasDraft).toBe(true);
    expect(data.stagePlan).toEqual(createRivalsTemplate().stagePlan);
    expect(data.kind).toBe("Rivals");
  });

  it("a draft Major save re-canonicalizes tampered fixed rules from the factory", () => {
    const major = createMajorTemplate();
    const tampered = formInput({
      template: "major",
      kind: "自定义",
      registrationMode: "solo",
      hasCaptainVoting: true,
      hasDraft: true,
      stagePlan: [{ ...major.stagePlan[0]!, teamCount: 4, advanceTiers: [{ placement: "*", count: 4 }] }],
      teamRegistrationConfig: { ...major.teamRegistrationConfig, requireCompetitiveProfile: false },
      maxTeamSize: 9,
    });
    const data = resolveCompetitionDefinition(tampered as never, true);
    expect(data.registrationMode).toBe("team");
    expect(data.hasCaptainVoting).toBe(false);
    expect(data.hasDraft).toBe(false);
    expect(data.stagePlan).toEqual(major.stagePlan);
    expect(data.teamRegistrationConfig.requireCompetitiveProfile).toBe(true);
    expect(data.affiliationRules).toEqual(major.affiliationRules);
    expect(data.kind).toBe("Major");
  });

  it("a draft Rivals save keeps canonical fixed rules while overlaying team size, positions and map pool", () => {
    const rivals = createRivalsTemplate();
    const input = formInput({
      template: "rivals",
      registrationMode: "team",
      hasDraft: false,
      minTeamSize: 6,
      maxTeamSize: 8,
      positions: ["igl", "awper", "opener", "closer", "anchor", "sub"],
      registrationConfig: { ...formInput().registrationConfig, mapPool: ["de_mirage", "de_inferno", "de_nuke", "de_ancient"] },
    });
    const data = resolveCompetitionDefinition(input as never, true);
    expect(data.registrationMode).toBe("solo");
    expect(data.hasDraft).toBe(true);
    expect(data.stagePlan).toEqual(rivals.stagePlan);
    expect(data.minTeamSize).toBe(6);
    expect(data.maxTeamSize).toBe(8);
    expect(data.positions).toHaveLength(6);
    expect(data.registrationConfig.mapPool).toEqual(["de_mirage", "de_inferno", "de_nuke", "de_ancient"]);
  });

  it("non-template input passes through untouched (custom/non-draft path)", () => {
    const input = formInput({ template: "custom" });
    const data = resolveCompetitionDefinition(input as never, false);
    const expected: Record<string, unknown> = { ...(input as never as Record<string, unknown>) };
    delete expected.template;
    expect(data).toEqual(expected);
  });
});

describe("isStageExecutorSupported", () => {
  it("supports exactly the active executor registry for custom tournaments", () => {
    expect(isStageExecutorSupported("round_robin")).toBe(true);
    expect(isStageExecutorSupported("single_elim")).toBe(true);
    expect(isStageExecutorSupported("double_elim")).toBe(true);
    expect(isStageExecutorSupported("swiss")).toBe(false);
    expect(isStageExecutorSupported("gsl_group")).toBe(false);
  });
});
