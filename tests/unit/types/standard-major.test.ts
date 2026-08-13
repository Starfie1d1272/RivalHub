import { describe, expect, it } from "vitest";
import {
  RIVALS_DEFAULT_CAPABILITIES,
  checkStandardMajorCapabilities,
  createMajorDefaultCapabilities,
} from "@/types/season";

function expectFailure(
  capabilities: ReturnType<typeof createMajorDefaultCapabilities>,
  key: string,
) {
  const result = checkStandardMajorCapabilities(capabilities);
  expect(result.isStandardMajor).toBe(false);
  expect(result.failures).toEqual(
    expect.arrayContaining([expect.objectContaining({ key, passed: false })]),
  );
}

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

    expectFailure(capabilities, "registration-mode");
  });

  it("rejects captain voting or snake draft", () => {
    const votingEnabled = createMajorDefaultCapabilities();
    votingEnabled.hasCaptainVoting = true;
    expectFailure(votingEnabled, "captain-voting");

    const draftEnabled = createMajorDefaultCapabilities();
    draftEnabled.hasDraft = true;
    expectFailure(draftEnabled, "draft");
  });

  it("allows event-specific team roster limits", () => {
    const capabilities = createMajorDefaultCapabilities();
    capabilities.maxTeamSize = 8;

    expect(checkStandardMajorCapabilities(capabilities).isStandardMajor).toBe(true);
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

    expectFailure(capabilities, "entry-cohorts");
  });

  it("rejects a changed stage team count", () => {
    const capabilities = createMajorDefaultCapabilities();
    capabilities.stagePlan[1].teamCount = 24;

    expectFailure(capabilities, "stage2");
  });

  it("rejects a changed Swiss advancement relationship", () => {
    const capabilities = createMajorDefaultCapabilities();
    capabilities.stagePlan[2].advanceTiers = [{ placement: "*", count: 6 }];

    expectFailure(capabilities, "stage3");
  });

  it("rejects a changed 16 / 8 / 8 entry cohort", () => {
    const capabilities = createMajorDefaultCapabilities();
    capabilities.stagePlan[1].entrySeeds = 7;

    expectFailure(capabilities, "entry-cohorts");
  });

  it("requires Stage 1 to contain exactly the unique 17–32 seed cohort", () => {
    const wrongCohort = createMajorDefaultCapabilities();
    wrongCohort.stagePlan[0].seeds = Array.from({ length: 16 }, (_, index) => index + 1);
    expectFailure(wrongCohort, "stage1-seeds");

    const missingCohort = createMajorDefaultCapabilities();
    missingCohort.stagePlan[0].seeds = undefined;
    expectFailure(missingCohort, "stage1-seeds");
  });

  it("rejects a changed playoff structure", () => {
    const capabilities = createMajorDefaultCapabilities();
    capabilities.stagePlan[3].teamCount = 4;

    expectFailure(capabilities, "playoff");
  });

  it("accepts Stage 3 BO1 or BO3 plus optional playoff variants", () => {
    const capabilities = createMajorDefaultCapabilities();
    capabilities.stagePlan[2].matchFormat = "bo1";
    capabilities.stagePlan[3].hasThirdPlaceMatch = true;
    capabilities.stagePlan[3].finalFormat = "bo3";

    expect(checkStandardMajorCapabilities(capabilities).isStandardMajor).toBe(true);

    capabilities.stagePlan[2].matchFormat = "bo3";
    expect(checkStandardMajorCapabilities(capabilities).isStandardMajor).toBe(true);
  });

  it.each([
    ["bo1", "bo1", "bo1"],
    ["bo1", "bo1", "bo3"],
    ["bo1", "bo3", "bo1"],
    ["bo1", "bo3", "bo3"],
    ["bo3", "bo1", "bo1"],
    ["bo3", "bo1", "bo3"],
    ["bo3", "bo3", "bo1"],
    ["bo3", "bo3", "bo3"],
  ] as const)("accepts Swiss formats %s / %s / %s", (stage1Format, stage2Format, stage3Format) => {
    const capabilities = createMajorDefaultCapabilities();
    capabilities.stagePlan[0].matchFormat = stage1Format;
    capabilities.stagePlan[1].matchFormat = stage2Format;
    capabilities.stagePlan[2].matchFormat = stage3Format;

    expect(checkStandardMajorCapabilities(capabilities).isStandardMajor).toBe(true);
  });

  it.each([0, 1, 2])("rejects BO5 in Swiss Stage %i", (stageIndex) => {
    const capabilities = createMajorDefaultCapabilities();
    capabilities.stagePlan[stageIndex].matchFormat = "bo5";

    const result = checkStandardMajorCapabilities(capabilities);
    expectFailure(capabilities, "swiss-match-format");
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "swiss-match-format",
          reason: "Major 瑞士阶段仅支持 BO1 或 BO3。",
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
