import type {
  InstitutionAffiliationRule,
  RegistrationConfig,
  StageConfig,
  StagePlan,
  StageType,
  TeamRegistrationConfig,
} from "@/types/season";

/**
 * Historical fallbacks for persisted rows that predate complete season
 * configuration. These values intentionally do not import current templates:
 * changing a current product default must not reinterpret an old row.
 */
const LEGACY_RIVALS_REGISTRATION_FALLBACK: RegistrationConfig = {
  allowedPlayerTypes: ["enrolled", "graduated"],
  rankThreshold: { currentMin: "A", peakMin: "A+" },
  maxPerPosition: 15,
  screenshotCount: 1,
  maxTotal: 56,
  mapPool: ["de_mirage", "de_inferno", "de_nuke", "de_ancient", "de_dust2", "de_anubis", "de_cache"],
};

const LEGACY_TEAM_REGISTRATION_FALLBACK: TeamRegistrationConfig = {
  allowExternal: true,
  graduateCountsAsHome: false,
  minHomeMembers: 0,
  minEnrolledMembers: 0,
  maxExternalMembers: 0,
  requirePositions: false,
  maxPerPositionPerTeam: 0,
  captainCanKick: true,
  captainCanTransfer: true,
  lockAfterRegistration: false,
  requireUniqueTeamName: true,
  requireTeamLogo: false,
  requireCompetitiveProfile: false,
};

const LEGACY_RIVALS_STAGE_PLAN_FALLBACK: StagePlan = [
  {
    key: "qualifier", name: "排位赛", type: "round_robin", teamCount: 8,
    advanceTiers: [{ placement: "*", count: 8 }],
    matchFormat: "bo1",
  },
  {
    key: "playoff", name: "正赛", type: "double_elim", teamCount: 8,
    advanceTiers: [{ placement: "1st", count: 1 }],
    matchFormat: "bo3",
    finalFormat: "bo5",
  },
];

type PartialRegistrationConfig = Partial<Omit<RegistrationConfig, "rankThreshold">> & {
  rankThreshold?: Partial<RegistrationConfig["rankThreshold"]>;
};

export function normalizeRegistrationConfig(
  config: PartialRegistrationConfig | null | undefined,
): RegistrationConfig {
  const currentMin =
    config?.rankThreshold?.currentMin === undefined
      ? LEGACY_RIVALS_REGISTRATION_FALLBACK.rankThreshold.currentMin
      : config.rankThreshold.currentMin;
  const peakMin =
    config?.rankThreshold?.peakMin === undefined
      ? LEGACY_RIVALS_REGISTRATION_FALLBACK.rankThreshold.peakMin
      : config.rankThreshold.peakMin;

  return {
    allowedPlayerTypes:
      config?.allowedPlayerTypes?.length
        ? [...config.allowedPlayerTypes]
        : [...LEGACY_RIVALS_REGISTRATION_FALLBACK.allowedPlayerTypes],
    rankThreshold: {
      currentMin,
      peakMin,
    },
    maxPerPosition: config?.maxPerPosition ?? LEGACY_RIVALS_REGISTRATION_FALLBACK.maxPerPosition,
    screenshotCount: config?.screenshotCount ?? LEGACY_RIVALS_REGISTRATION_FALLBACK.screenshotCount,
    maxTotal: config?.maxTotal ?? LEGACY_RIVALS_REGISTRATION_FALLBACK.maxTotal,
    mapPool: config?.mapPool?.length
      ? [...new Set(config.mapPool)]
      : [...LEGACY_RIVALS_REGISTRATION_FALLBACK.mapPool],
  };
}

type PartialTeamConfig = Partial<TeamRegistrationConfig>;

export function normalizeTeamRegistrationConfig(
  config: PartialTeamConfig | null | undefined,
): TeamRegistrationConfig {
  return {
    allowExternal: config?.allowExternal ?? LEGACY_TEAM_REGISTRATION_FALLBACK.allowExternal,
    graduateCountsAsHome: config?.graduateCountsAsHome ?? LEGACY_TEAM_REGISTRATION_FALLBACK.graduateCountsAsHome,
    minHomeMembers: config?.minHomeMembers ?? LEGACY_TEAM_REGISTRATION_FALLBACK.minHomeMembers,
    minEnrolledMembers: config?.minEnrolledMembers ?? LEGACY_TEAM_REGISTRATION_FALLBACK.minEnrolledMembers,
    maxExternalMembers: config?.maxExternalMembers ?? LEGACY_TEAM_REGISTRATION_FALLBACK.maxExternalMembers,
    requirePositions: config?.requirePositions ?? LEGACY_TEAM_REGISTRATION_FALLBACK.requirePositions,
    maxPerPositionPerTeam: config?.maxPerPositionPerTeam ?? LEGACY_TEAM_REGISTRATION_FALLBACK.maxPerPositionPerTeam,
    captainCanKick: config?.captainCanKick ?? LEGACY_TEAM_REGISTRATION_FALLBACK.captainCanKick,
    captainCanTransfer: config?.captainCanTransfer ?? LEGACY_TEAM_REGISTRATION_FALLBACK.captainCanTransfer,
    lockAfterRegistration: config?.lockAfterRegistration ?? LEGACY_TEAM_REGISTRATION_FALLBACK.lockAfterRegistration,
    requireUniqueTeamName: config?.requireUniqueTeamName ?? LEGACY_TEAM_REGISTRATION_FALLBACK.requireUniqueTeamName,
    requireTeamLogo: config?.requireTeamLogo ?? LEGACY_TEAM_REGISTRATION_FALLBACK.requireTeamLogo,
    requireCompetitiveProfile: config?.requireCompetitiveProfile ?? LEGACY_TEAM_REGISTRATION_FALLBACK.requireCompetitiveProfile,
    competitiveProfile: config?.competitiveProfile
      ? {
          platform: config.competitiveProfile.platform.trim(),
          currentSeasonKey: config.competitiveProfile.currentSeasonKey.trim(),
          previousSeasonKey: config.competitiveProfile.previousSeasonKey.trim(),
          rankOrder: [...new Set(config.competitiveProfile.rankOrder.map((rank) => rank.trim()).filter(Boolean))],
          externalStrengthMaxStarGap: Math.max(0, Math.trunc(config.competitiveProfile.externalStrengthMaxStarGap ?? 3)),
          evidencePolicy: config.competitiveProfile.evidencePolicy
            ? {
                historicalWeight: 50,
                referenceSeasonKey: config.competitiveProfile.evidencePolicy.referenceSeasonKey.trim(),
                referenceSeasonWeight: 20,
                recentSeasonKeys: [...new Set(config.competitiveProfile.evidencePolicy.recentSeasonKeys.map((key) => key.trim()).filter(Boolean))],
                recentSeasonWeight: 30,
                ...(config.competitiveProfile.evidencePolicy.sourceSelection === "primary_then_fallback" || config.competitiveProfile.evidencePolicy.sourceSelection === "strongest_equivalent"
                  ? { sourceSelection: config.competitiveProfile.evidencePolicy.sourceSelection }
                  : {}),
              }
            : undefined,
          conversionPolicyVersion: config.competitiveProfile.conversionPolicyVersion?.trim() || undefined,
          conversionPolicyId: config.competitiveProfile.conversionPolicyId?.trim() || undefined,
          fallbackConversion: config.competitiveProfile.fallbackConversion
            ? {
                sourcePlatform: "fivee",
                version: config.competitiveProfile.fallbackConversion.version.trim(),
                seasonKeyMap: Object.fromEntries(Object.entries(config.competitiveProfile.fallbackConversion.seasonKeyMap)
                  .map(([primary, source]) => [primary.trim(), source.trim()])
                  .filter(([primary, source]) => primary && source)),
                ...(config.competitiveProfile.fallbackConversion.mapping
                  ? { mapping: config.competitiveProfile.fallbackConversion.mapping }
                  : {}),
                ...(config.competitiveProfile.fallbackConversion.rankMap
                  ? {
                      rankMap: Object.fromEntries(
                        Object.entries(config.competitiveProfile.fallbackConversion.rankMap)
                          .map(([source, target]) => [source.trim(), target.trim()])
                          .filter(([source, target]) => source && target),
                      ),
                    }
                  : {}),
              }
            : undefined,
        }
      : undefined,
  };
}

export function normalizeAffiliationRules(
  rules: readonly InstitutionAffiliationRule[] | null | undefined,
): InstitutionAffiliationRule[] {
  if (!rules) return [];
  return rules
    .filter((rule) => rule.institutionCode.trim() && Number.isInteger(rule.minRosterMembers) && Number.isInteger(rule.minStartingMembers))
    .map((rule) => ({
      institutionCode: rule.institutionCode.trim(),
      eligibleAcademicStatuses: [...new Set(rule.eligibleAcademicStatuses.filter((status) => status === "enrolled" || status === "graduated"))],
      minRosterMembers: Math.max(0, rule.minRosterMembers),
      minStartingMembers: Math.max(0, rule.minStartingMembers),
    }));
}

export function normalizeStagePlan(stagePlan: StagePlan | null | undefined): StagePlan {
  return stagePlan ?? LEGACY_RIVALS_STAGE_PLAN_FALLBACK;
}

export function getStageByKey(stagePlan: StagePlan | null | undefined, key: string): StageConfig | null {
  return normalizeStagePlan(stagePlan).find((stage) => stage.key === key) ?? null;
}

export function getFirstStage(stagePlan: StagePlan | null | undefined): StageConfig | null {
  return normalizeStagePlan(stagePlan)[0] ?? null;
}

export function getPreviousStage(stagePlan: StagePlan | null | undefined, key: string): StageConfig | null {
  const stages = normalizeStagePlan(stagePlan);
  const index = stages.findIndex((stage) => stage.key === key);
  return index > 0 ? stages[index - 1] ?? null : null;
}

export function getFirstStageOfType(
  stagePlan: StagePlan | null | undefined,
  types: readonly StageType[],
): StageConfig | null {
  return normalizeStagePlan(stagePlan).find((stage) => types.includes(stage.type)) ?? null;
}
