import { describe, expect, it } from "vitest";
import { createRivalsTemplate } from "@/lib/competition/templates";
import {
  normalizeAffiliationRules,
  normalizeRegistrationConfig,
  normalizeStagePlan,
  normalizeTeamRegistrationConfig,
} from "@/lib/seasons/compatibility";

describe("historical season compatibility", () => {
  it("uses the frozen legacy Rivals stage plan for a missing historical plan", () => {
    expect(normalizeStagePlan(null)).toEqual([
      expect.objectContaining({ key: "qualifier", type: "round_robin", teamCount: 8 }),
      expect.objectContaining({ key: "playoff", type: "double_elim", teamCount: 8 }),
    ]);
  });

  it("fills partial historical registration config with the legacy d60c9 behavior", () => {
    expect(normalizeRegistrationConfig({ rankThreshold: { currentMin: null } })).toEqual({
      allowedPlayerTypes: ["enrolled", "graduated"],
      rankThreshold: { currentMin: null, peakMin: "A+" },
      maxPerPosition: 15,
      screenshotCount: 1,
      maxTotal: 56,
      mapPool: ["de_mirage", "de_inferno", "de_nuke", "de_ancient", "de_dust2", "de_anubis", "de_cache"],
    });
  });

  it("fills partial historical team config without making the logo required", () => {
    const config = normalizeTeamRegistrationConfig({ allowExternal: true });
    expect(config.allowExternal).toBe(true);
    expect(config.maxExternalMembers).toBe(0);
    expect(config.requireTeamLogo).toBe(false);
    expect(config.requireCompetitiveProfile).toBe(false);
  });

  it("keeps missing sourceSelection on the legacy primary-first path", () => {
    const config = normalizeTeamRegistrationConfig({
      competitiveProfile: {
        platform: " perfect_world ",
        currentSeasonKey: "current",
        previousSeasonKey: "previous",
        rankOrder: ["A"],
        evidencePolicy: {
          historicalWeight: 50,
          referenceSeasonKey: "reference",
          referenceSeasonWeight: 20,
          recentSeasonKeys: ["recent"],
          recentSeasonWeight: 30,
        },
      },
    });

    expect(config.competitiveProfile?.evidencePolicy).toEqual({
      historicalWeight: 50,
      referenceSeasonKey: "reference",
      referenceSeasonWeight: 20,
      recentSeasonKeys: ["recent"],
      recentSeasonWeight: 30,
    });
    expect(config.competitiveProfile?.evidencePolicy).not.toHaveProperty("sourceSelection");
  });

  it("preserves a legacy fallbackConversion rankMap", () => {
    const config = normalizeTeamRegistrationConfig({
      competitiveProfile: {
        platform: "perfect_world",
        currentSeasonKey: "current",
        previousSeasonKey: "previous",
        rankOrder: ["A"],
        fallbackConversion: {
          sourcePlatform: "fivee",
          version: "legacy-1",
          seasonKeyMap: { current: "source-current" },
          rankMap: { "source-A": "A" },
        },
      },
    });

    expect(config.competitiveProfile?.fallbackConversion?.rankMap).toEqual({ "source-A": "A" });
  });

  it("keeps current template edits independent from historical fallbacks", () => {
    const current = createRivalsTemplate();
    current.registrationConfig.maxTotal = 1;
    current.stagePlan[0]!.teamCount = 2;

    expect(normalizeRegistrationConfig({}).maxTotal).toBe(56);
    expect(normalizeStagePlan(null)[0]?.teamCount).toBe(8);
  });

  it("preserves affiliation normalization semantics", () => {
    expect(normalizeAffiliationRules([
      {
        institutionCode: " 4132010284 ",
        eligibleAcademicStatuses: ["enrolled", "enrolled", "graduated", "external"] as never,
        minRosterMembers: -2,
        minStartingMembers: 3,
      },
      {
        institutionCode: " ",
        eligibleAcademicStatuses: ["enrolled"],
        minRosterMembers: 1,
        minStartingMembers: 1,
      },
    ] as never)).toEqual([{
      institutionCode: "4132010284",
      eligibleAcademicStatuses: ["enrolled", "graduated"],
      minRosterMembers: 0,
      minStartingMembers: 3,
    }]);
  });
});
