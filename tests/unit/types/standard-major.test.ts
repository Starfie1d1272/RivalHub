import { describe, expect, it } from "vitest";
import {
  DEFAULT_CS2_MAP_POOL,
  MAJOR_REGISTRATION_CONFIG,
  OPEN_TOURNAMENT_PRESET,
  RIVALS_DEFAULT_CAPABILITIES,
  checkStandardMajorCapabilities,
  createMajorDefaultCapabilities,
  normalizeTeamRegistrationConfig,
} from "@/types/season";

describe("checkStandardMajorCapabilities()", () => {
  it("accepts the current standard Major defaults", () => {
    const capabilities = createMajorDefaultCapabilities();
    const result = checkStandardMajorCapabilities(capabilities);

    expect(result.isStandardMajor).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.checks.every((check) => check.passed)).toBe(true);
    expect(capabilities.stagePlan[2]?.matchFormat).toBe("bo3");
    expect(result.checks).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "stage1-seeds", passed: true })]),
    );
    expect(capabilities.stagePlan.map((stage) => stage.matchFormat)).toEqual(["bo1", "bo1", "bo3", "bo3"]);
    expect(capabilities.stagePlan[3]?.finalFormat).toBe("bo5");
    expect(MAJOR_REGISTRATION_CONFIG.mapPool).toEqual([
      "de_ancient", "de_anubis", "de_cache", "de_dust2", "de_inferno", "de_mirage", "de_nuke",
    ]);
    expect(RIVALS_DEFAULT_CAPABILITIES.registrationConfig.mapPool).toEqual([...DEFAULT_CS2_MAP_POOL]);
    expect(MAJOR_REGISTRATION_CONFIG.mapPool).not.toContain("de_overpass");
    expect(RIVALS_DEFAULT_CAPABILITIES.registrationConfig.mapPool).toContain("de_overpass");
  });

  it("accepts a deep clone of the standard Major defaults", () => {
    const result = checkStandardMajorCapabilities(
      structuredClone(createMajorDefaultCapabilities()),
    );

    expect(result.isStandardMajor).toBe(true);
  });

  it("rejects individual registration", () => {
    const capabilities = createMajorDefaultCapabilities();
    capabilities.registrationMode = "solo";

    const result = checkStandardMajorCapabilities(capabilities);
    expect(result).toMatchObject({
      isStandardMajor: false,
      failures: expect.arrayContaining([
        expect.objectContaining({ key: "registration-mode", passed: false }),
      ]),
    });
  });

  it("rejects a Major whose team size or starter count deviates from the fixed 5–9/5 rule", () => {
    const starterCountChanged = checkStandardMajorCapabilities({
      ...createMajorDefaultCapabilities(),
      starterCount: 6,
    });
    expect(starterCountChanged).toMatchObject({
      isStandardMajor: false,
      failures: expect.arrayContaining([
        expect.objectContaining({ key: "team-size", passed: false }),
      ]),
    });

    const teamSizeChanged = checkStandardMajorCapabilities({
      ...createMajorDefaultCapabilities(),
      minTeamSize: 6,
      maxTeamSize: 10,
    });
    expect(teamSizeChanged).toMatchObject({
      isStandardMajor: false,
      failures: expect.arrayContaining([
        expect.objectContaining({ key: "team-size", passed: false }),
      ]),
    });
  });

  it("rejects captain voting or snake draft", () => {
    const votingEnabled = createMajorDefaultCapabilities();
    votingEnabled.hasCaptainVoting = true;
    const votingResult = checkStandardMajorCapabilities(votingEnabled);
    expect(votingResult).toMatchObject({
      isStandardMajor: false,
      failures: expect.arrayContaining([
        expect.objectContaining({ key: "captain-voting", passed: false }),
      ]),
    });

    const draftEnabled = createMajorDefaultCapabilities();
    draftEnabled.hasDraft = true;
    const draftResult = checkStandardMajorCapabilities(draftEnabled);
    expect(draftResult).toMatchObject({
      isStandardMajor: false,
      failures: expect.arrayContaining([
        expect.objectContaining({ key: "draft", passed: false }),
      ]),
    });
  });

  it("rejects event-specific team roster limits: 5–9/5 is part of the standard identity", () => {
    const maxTeamSizeChanged = createMajorDefaultCapabilities();
    maxTeamSizeChanged.maxTeamSize = 8;
    const maxTeamSizeResult = checkStandardMajorCapabilities(maxTeamSizeChanged);
    expect(maxTeamSizeResult).toMatchObject({
      isStandardMajor: false,
      failures: expect.arrayContaining([
        expect.objectContaining({ key: "team-size", passed: false }),
      ]),
    });

    const minTeamSizeChanged = createMajorDefaultCapabilities();
    minTeamSizeChanged.minTeamSize = 4;
    const minTeamSizeResult = checkStandardMajorCapabilities(minTeamSizeChanged);
    expect(minTeamSizeResult).toMatchObject({
      isStandardMajor: false,
      failures: expect.arrayContaining([
        expect.objectContaining({ key: "team-size", passed: false }),
      ]),
    });
  });

  it("allows event-specific registration limits and map pools", () => {
    const capabilities = createMajorDefaultCapabilities();
    capabilities.registrationConfig.maxTotal = 56;
    capabilities.registrationConfig.mapPool = ["de_mirage", "de_nuke", "de_inferno"];

    expect(checkStandardMajorCapabilities(capabilities).isStandardMajor).toBe(true);
  });

  it("rejects reordered stage entry cohorts", () => {
    const capabilities = createMajorDefaultCapabilities();
    [capabilities.stagePlan[0], capabilities.stagePlan[1]] = [
      capabilities.stagePlan[1],
      capabilities.stagePlan[0],
    ];

    const result = checkStandardMajorCapabilities(capabilities);
    expect(result).toMatchObject({
      isStandardMajor: false,
      failures: expect.arrayContaining([
        expect.objectContaining({ key: "entry-cohorts", passed: false }),
      ]),
    });
  });

  it("rejects a changed stage team count", () => {
    const capabilities = createMajorDefaultCapabilities();
    capabilities.stagePlan[1].teamCount = 24;

    const result = checkStandardMajorCapabilities(capabilities);
    expect(result).toMatchObject({
      isStandardMajor: false,
      failures: expect.arrayContaining([
        expect.objectContaining({ key: "stage2", passed: false }),
      ]),
    });
  });

  it("rejects a changed Swiss advancement relationship", () => {
    const capabilities = createMajorDefaultCapabilities();
    capabilities.stagePlan[2].advanceTiers = [{ placement: "*", count: 6 }];

    const result = checkStandardMajorCapabilities(capabilities);
    expect(result).toMatchObject({
      isStandardMajor: false,
      failures: expect.arrayContaining([
        expect.objectContaining({ key: "stage3", passed: false }),
      ]),
    });
  });

  it("rejects a changed 16 / 8 / 8 entry cohort", () => {
    const capabilities = createMajorDefaultCapabilities();
    capabilities.stagePlan[1].entrySeeds = 7;

    const result = checkStandardMajorCapabilities(capabilities);
    expect(result).toMatchObject({
      isStandardMajor: false,
      failures: expect.arrayContaining([
        expect.objectContaining({ key: "entry-cohorts", passed: false }),
      ]),
    });
  });

  it("requires Stage 1 to contain exactly the unique 17–32 seed cohort", () => {
    const wrongCohort = createMajorDefaultCapabilities();
    wrongCohort.stagePlan[0].seeds = Array.from({ length: 16 }, (_, index) => index + 1);
    const wrongCohortResult = checkStandardMajorCapabilities(wrongCohort);
    expect(wrongCohortResult).toMatchObject({
      isStandardMajor: false,
      failures: expect.arrayContaining([
        expect.objectContaining({ key: "stage1-seeds", passed: false }),
      ]),
    });

    const missingCohort = createMajorDefaultCapabilities();
    missingCohort.stagePlan[0].seeds = undefined;
    const missingCohortResult = checkStandardMajorCapabilities(missingCohort);
    expect(missingCohortResult).toMatchObject({
      isStandardMajor: false,
      failures: expect.arrayContaining([
        expect.objectContaining({ key: "stage1-seeds", passed: false }),
      ]),
    });
  });

  it("rejects a changed playoff structure", () => {
    const capabilities = createMajorDefaultCapabilities();
    capabilities.stagePlan[3].teamCount = 4;

    const result = checkStandardMajorCapabilities(capabilities);
    expect(result).toMatchObject({
      isStandardMajor: false,
      failures: expect.arrayContaining([
        expect.objectContaining({ key: "playoff", passed: false }),
      ]),
    });
  });

  it("rejects stage-format changes that would violate the frozen NJU Major policy", () => {
    const capabilities = createMajorDefaultCapabilities();
    capabilities.stagePlan[2].matchFormat = "bo1";
    const swissFormatResult = checkStandardMajorCapabilities(capabilities);
    expect(swissFormatResult).toMatchObject({
      isStandardMajor: false,
      failures: expect.arrayContaining([
        expect.objectContaining({ key: "swiss-match-format", passed: false }),
      ]),
    });

    const stage1Bo3 = createMajorDefaultCapabilities();
    stage1Bo3.stagePlan[0].matchFormat = "bo3";
    const stage1Bo3Result = checkStandardMajorCapabilities(stage1Bo3);
    expect(stage1Bo3Result).toMatchObject({
      isStandardMajor: false,
      failures: expect.arrayContaining([
        expect.objectContaining({ key: "swiss-match-format", passed: false }),
      ]),
    });

    const stage2Bo3 = createMajorDefaultCapabilities();
    stage2Bo3.stagePlan[1].matchFormat = "bo3";
    const stage2Bo3Result = checkStandardMajorCapabilities(stage2Bo3);
    expect(stage2Bo3Result).toMatchObject({
      isStandardMajor: false,
      failures: expect.arrayContaining([
        expect.objectContaining({ key: "swiss-match-format", passed: false }),
      ]),
    });

    const playoffBo1 = createMajorDefaultCapabilities();
    playoffBo1.stagePlan[3].matchFormat = "bo1";
    const playoffBo1Result = checkStandardMajorCapabilities(playoffBo1);
    expect(playoffBo1Result).toMatchObject({
      isStandardMajor: false,
      failures: expect.arrayContaining([
        expect.objectContaining({ key: "playoff", passed: false }),
      ]),
    });

    const finalBo3 = createMajorDefaultCapabilities();
    finalBo3.stagePlan[3].finalFormat = "bo3";
    const finalBo3Result = checkStandardMajorCapabilities(finalBo3);
    expect(finalBo3Result).toMatchObject({
      isStandardMajor: false,
      failures: expect.arrayContaining([
        expect.objectContaining({ key: "playoff", passed: false }),
      ]),
    });
  });

  it.each([0, 1, 2])("rejects BO5 in Swiss Stage %i", (stageIndex) => {
    const capabilities = createMajorDefaultCapabilities();
    capabilities.stagePlan[stageIndex].matchFormat = "bo5";

    const result = checkStandardMajorCapabilities(capabilities);
    expect(result).toMatchObject({
      isStandardMajor: false,
      failures: expect.arrayContaining([
        expect.objectContaining({ key: "swiss-match-format", passed: false }),
      ]),
    });
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "swiss-match-format",
          reason: "NJU Major 阶段一、阶段二的普通比赛为 BO1，决定晋级或淘汰的比赛由 Swiss 引擎升级为 BO3；阶段三全部为 BO3。",
        }),
      ]),
    );
  });

  it("ignores display-only fields outside the capability contract", () => {
    const capabilities = {
      ...createMajorDefaultCapabilities(),
      kind: "任何展示文字",
      name: "自定义赛事名称",
    };

    expect(checkStandardMajorCapabilities(capabilities).isStandardMajor).toBe(true);
  });
});

describe("createMajorDefaultCapabilities()", () => {
  it("returns a complete Major replacement without Rivals registration leftovers", () => {
    const rivals = structuredClone(RIVALS_DEFAULT_CAPABILITIES);
    const major = createMajorDefaultCapabilities();

    expect(rivals.registrationConfig.maxTotal).toBe(56);
    expect(major.registrationConfig.maxTotal).toBe(256);
    expect(major.teamRegistrationConfig.requireTeamLogo).toBe(true);
    expect(major.teamRegistrationConfig.competitiveProfile?.platform).toBe("perfect_world");
    expect(major.teamRegistrationConfig.competitiveProfile?.rankOrder).toEqual([]);
    expect(major).not.toBe(rivals);
    expect(checkStandardMajorCapabilities(major).isStandardMajor).toBe(true);
  });

  it("returns independent editable copies", () => {
    const first = createMajorDefaultCapabilities();
    const second = createMajorDefaultCapabilities();
    first.registrationConfig.maxTotal = 1;
    first.stagePlan[0].teamCount = 2;

    expect(second.registrationConfig.maxTotal).toBe(256);
    expect(second.stagePlan[0].teamCount).toBe(16);
  });
});

describe("normalizeTeamRegistrationConfig()", () => {
  it("keeps a legacy partial config logo-optional", () => {
    expect(normalizeTeamRegistrationConfig({ allowExternal: true }).requireTeamLogo).toBe(false);
  });

  it("preserves explicit logo requirements", () => {
    expect(normalizeTeamRegistrationConfig({ requireTeamLogo: true }).requireTeamLogo).toBe(true);
    expect(normalizeTeamRegistrationConfig({ requireTeamLogo: false }).requireTeamLogo).toBe(false);
  });

  it("keeps the open tournament preset logo-optional", () => {
    expect(OPEN_TOURNAMENT_PRESET.teamRegistrationConfig.requireTeamLogo).toBe(false);
  });
});
