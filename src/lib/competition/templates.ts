import { CS2_MAP_CATALOG, CURRENT_CS2_ACTIVE_DUTY_MAP_POOL } from "@/lib/config/cs2-maps";
import { CS2_POSITION_VALUES } from "@/lib/config/cs2-positions";
import type {
  RegistrationConfig,
  SeasonCapabilities,
  StagePlan,
  TeamRegistrationConfig,
} from "@/types/season";

/** Product templates are the only source for the built-in competition defaults. */
export type CompetitionTemplate = "rivals" | "major" | "custom";

export const MAJOR_TEAM_CONFIG: TeamRegistrationConfig = {
  allowExternal: true,
  graduateCountsAsHome: true,
  minHomeMembers: 0,
  minEnrolledMembers: 0,
  maxExternalMembers: 99,
  requirePositions: false,
  maxPerPositionPerTeam: 2,
  captainCanKick: true,
  captainCanTransfer: true,
  lockAfterRegistration: true,
  requireUniqueTeamName: true,
  requireTeamLogo: true,
  requireCompetitiveProfile: true,
  competitiveProfile: {
    platform: "perfect_world",
    currentSeasonKey: "",
    previousSeasonKey: "",
    rankOrder: [],
    externalStrengthMaxStarGap: 3,
  },
};

export const RIVALS_STAGE_PLAN: StagePlan = [
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

export const RIVALS_REGISTRATION_CONFIG: RegistrationConfig = {
  allowedPlayerTypes: ["enrolled", "graduated"],
  rankThreshold: { currentMin: "A", peakMin: "A+" },
  maxPerPosition: 15,
  screenshotCount: 1,
  maxTotal: 56,
  mapPool: [...CURRENT_CS2_ACTIVE_DUTY_MAP_POOL],
};

/** 选秀联赛预设：个人报名 → 队长投票 → 蛇形选秀 → 循环赛 + 双败淘汰 */
const DRAFT_LEAGUE_PRESET: SeasonCapabilities = {
  registrationMode: "solo",
  hasCaptainVoting: true,
  hasDraft: true,
  hasCommunityAwards: true,
  stagePlan: RIVALS_STAGE_PLAN,
  registrationConfig: RIVALS_REGISTRATION_CONFIG,
  teamRegistrationConfig: {
    allowExternal: false,
    graduateCountsAsHome: false,
    minHomeMembers: 0,
    minEnrolledMembers: 0,
    maxExternalMembers: 0,
    requirePositions: false,
    maxPerPositionPerTeam: 0,
    captainCanKick: false,
    captainCanTransfer: false,
    lockAfterRegistration: false,
    requireUniqueTeamName: false,
    requireTeamLogo: false,
  },
  affiliationRules: [],
  maxTeamSize: 7,
  minTeamSize: 7,
  starterCount: 5,
  positions: [...CS2_POSITION_VALUES],
};

/** 公开赛预设：自由组队报名 → 循环赛 + 双败淘汰 */
export const OPEN_TOURNAMENT_PRESET: SeasonCapabilities = {
  registrationMode: "team",
  hasCaptainVoting: false,
  hasDraft: false,
  hasCommunityAwards: true,
  stagePlan: RIVALS_STAGE_PLAN,
  registrationConfig: RIVALS_REGISTRATION_CONFIG,
  teamRegistrationConfig: { ...MAJOR_TEAM_CONFIG, requireTeamLogo: false },
  affiliationRules: [],
  maxTeamSize: 5,
  minTeamSize: 5,
  starterCount: 5,
  positions: [...CS2_POSITION_VALUES],
};

/**
 * Major 预设：32 队，3 轮 Swiss + 1 轮 Single Elim。
 * 最后阶段是单败淘汰，不是瑞士轮。
 */
export const MAJOR_STAGE_PLAN: StagePlan = [
  {
    key: "stage1", name: "阶段一", type: "swiss", teamCount: 16,
    advanceTiers: [{ placement: "*", count: 8 }],
    matchFormat: "bo1",
    seeds: [17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32],
  },
  {
    key: "stage2", name: "阶段二", type: "swiss", teamCount: 16,
    entrySeeds: 8,
    advanceTiers: [{ placement: "*", count: 8 }],
    matchFormat: "bo1",
  },
  {
    key: "stage3", name: "阶段三", type: "swiss", teamCount: 16,
    entrySeeds: 8,
    advanceTiers: [{ placement: "*", count: 8 }],
    matchFormat: "bo3",
  },
  {
    key: "playoff", name: "淘汰赛", type: "single_elim", teamCount: 8,
    advanceTiers: [{ placement: "1st", count: 1 }],
    matchFormat: "bo3",
    finalFormat: "bo5",
  },
];

export const MAJOR_REGISTRATION_CONFIG: RegistrationConfig = {
  allowedPlayerTypes: ["enrolled", "graduated"],
  rankThreshold: { currentMin: null, peakMin: null },
  maxPerPosition: 50,
  screenshotCount: 1,
  maxTotal: 256,
  // NJU Major's announced pool is intentionally separate from the live Valve/default pool.
  mapPool: ["de_ancient", "de_anubis", "de_cache", "de_dust2", "de_inferno", "de_mirage", "de_nuke"],
};

const MAJOR_DEFAULT_CAPABILITIES: SeasonCapabilities = {
  registrationMode: "team",
  hasCaptainVoting: false,
  hasDraft: false,
  hasCommunityAwards: true,
  stagePlan: MAJOR_STAGE_PLAN,
  registrationConfig: MAJOR_REGISTRATION_CONFIG,
  teamRegistrationConfig: MAJOR_TEAM_CONFIG,
  affiliationRules: [{
    institutionCode: "4132010284",
    eligibleAcademicStatuses: ["enrolled", "graduated"],
    minRosterMembers: 3,
    minStartingMembers: 3,
  }],
  maxTeamSize: 9,
  minTeamSize: 5,
  starterCount: 5,
  positions: [...CS2_POSITION_VALUES],
};

function createBaseCompetitionTemplate(): SeasonCapabilities {
  return {
    registrationMode: "team",
    hasCaptainVoting: false,
    hasDraft: false,
    hasCommunityAwards: true,
    stagePlan: [],
    registrationConfig: {
      allowedPlayerTypes: ["enrolled", "graduated", "external"],
      rankThreshold: { currentMin: null, peakMin: null },
      maxPerPosition: 10,
      screenshotCount: 1,
      maxTotal: 128,
      mapPool: CS2_MAP_CATALOG.slice(0, 3).map(({ key }) => key),
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
    positions: [...CS2_POSITION_VALUES],
  };
}

export function createRivalsTemplate(): SeasonCapabilities {
  return structuredClone(DRAFT_LEAGUE_PRESET) as SeasonCapabilities;
}

export function createMajorTemplate(): SeasonCapabilities {
  return structuredClone(MAJOR_DEFAULT_CAPABILITIES) as SeasonCapabilities;
}

/** 返回可安全编辑的 Major 能力配置副本。 */
export function createMajorDefaultCapabilities(): SeasonCapabilities {
  return createMajorTemplate();
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
