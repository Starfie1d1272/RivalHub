import {
  CAPABILITY_PRESETS,
  type SeasonCapabilities,
} from "@/types/season";

/** Product templates are the only source for the built-in competition defaults. */
export type CompetitionTemplate = "rivals" | "major" | "custom";

function createBaseCompetitionTemplate(): SeasonCapabilities {
  return {
    registrationMode: "team",
    hasCaptainVoting: false,
    hasDraft: false,
    stagePlan: [],
    registrationConfig: {
      allowedPlayerTypes: ["enrolled", "graduated", "external"],
      rankThreshold: { currentMin: null, peakMin: null },
      maxPerPosition: 10,
      screenshotCount: 1,
      maxTotal: 128,
      mapPool: ["de_mirage", "de_inferno", "de_nuke"],
    },
    teamRegistrationConfig: {
      allowExternal: true,
      graduateCountsAsHome: false,
      minHomeMembers: 0,
      minEnrolledMembers: 0,
      maxExternalMembers: 0,
      requirePositions: false,
      maxPerPositionPerTeam: 5,
      captainCanKick: true,
      captainCanTransfer: true,
      lockAfterRegistration: true,
      requireUniqueTeamName: true,
      requireTeamLogo: false,
      requireCompetitiveProfile: false,
    },
    affiliationRules: [],
    minTeamSize: 5,
    maxTeamSize: 9,
    starterCount: 5,
    positions: ["igl", "awper", "opener", "closer", "anchor"],
  };
}

export function createRivalsTemplate(): SeasonCapabilities {
  return structuredClone(CAPABILITY_PRESETS["draft-league"]) as SeasonCapabilities;
}

export function createMajorTemplate(): SeasonCapabilities {
  return structuredClone(CAPABILITY_PRESETS.major) as SeasonCapabilities;
}

/**
 * A custom tournament starts from the smallest executable stage contract.
 * Administrators add stages through the structured editor before publishing.
 */
export function createCustomTournamentTemplate(): SeasonCapabilities {
  return createBaseCompetitionTemplate();
}

export function createCompetitionTemplate(template: CompetitionTemplate): SeasonCapabilities {
  switch (template) {
    case "rivals": return createRivalsTemplate();
    case "major": return createMajorTemplate();
    case "custom": return createCustomTournamentTemplate();
  }
}
