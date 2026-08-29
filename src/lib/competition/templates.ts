import {
  CAPABILITY_PRESETS,
  checkStandardMajorCapabilities,
  type SeasonCapabilities,
} from "@/types/season";

/** Product templates are the only source for the built-in competition defaults. */
export type CompetitionTemplate = "rivals" | "major" | "custom";

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
  return {
    ...createRivalsTemplate(),
    hasCaptainVoting: false,
    hasDraft: false,
    stagePlan: [],
  };
}

export function createCompetitionTemplate(template: CompetitionTemplate): SeasonCapabilities {
  switch (template) {
    case "rivals": return createRivalsTemplate();
    case "major": return createMajorTemplate();
    case "custom": return createCustomTournamentTemplate();
  }
}

export function inferCompetitionTemplate(capabilities: SeasonCapabilities): CompetitionTemplate {
  if (checkStandardMajorCapabilities(capabilities).isStandardMajor) return "major";
  if (
    capabilities.registrationMode === "solo" &&
    capabilities.hasCaptainVoting &&
    capabilities.hasDraft
  ) return "rivals";
  return "custom";
}
