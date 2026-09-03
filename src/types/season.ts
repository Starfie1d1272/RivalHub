// 共享赛季类型——与 Drizzle schema 对齐

export type SeasonKind = string;

export type SeasonStatus =
  | "draft"
  | "registration"
  | "voting"
  | "drafting"
  | "playing"
  | "finished"
  | "archived";

export type RegistrationMode = "solo" | "team";
export type StageType = "round_robin" | "double_elim" | "single_elim" | "swiss";
export type PlayerType = "enrolled" | "graduated" | "external";
export type MapPreferenceLevel = "none" | "basic" | "playable" | "proficient" | "strong";

export interface MapPreference {
  map: string;
  level: MapPreferenceLevel;
}

export interface AdvanceTier {
  /** 名次标识："*" = 全部晋级；"1st"/"2nd"/"3rd" 等 = 分层晋级 */
  placement: string;
  /** 该名次每组晋级队伍数；groupCount > 1 时总晋级数 = count × groupCount */
  count: number;
  /** 进入下一阶段的 bracket 入口轮次；默认不指定则由 executor 决定 */
  targetRound?: string;
}

export interface StageConfig {
  key: string;
  name: string;
  type: StageType;
  teamCount: number;
  advanceTiers: AdvanceTier[];
  groupCount?: number;
  matchFormat?: "bo1" | "bo3" | "bo5";
  /** 决赛 BO5 覆写（仅对淘汰赛阶段生效）。不设置则回退到 matchFormat。 */
  finalFormat?: "bo3" | "bo5";
  hasThirdPlaceMatch?: boolean;
  seeds?: number[];
  /** 直接进入本阶段的种子队数（非上一阶段晋级）。
   *  取赛季中 draft_order 最靠前且未通过 qualifiers 晋级的队伍。
   *  首阶段默认为 teamCount（全部队伍参赛），非首阶段默认为 0。 */
  entrySeeds?: number;
}

export type StagePlan = StageConfig[];

/** 阶段晋级结果，由 executor.getQualifiers() 返回 */
export interface QualifiedTeam {
  teamId: string;
  /** 对应 advanceTiers[].placement，如 "1st"、"2nd"、"*" */
  placement: string;
  /** 分组标识；groupCount > 1 时填充，单组阶段为 undefined */
  group?: string;
}

export interface RegistrationConfig {
  allowedPlayerTypes: PlayerType[];
  rankThreshold: {
    currentMin: string | null;
    peakMin: string | null;
  };
  maxPerPosition: number;
  screenshotCount: number;
  /** 总报名人数上限，默认 56。到达后新报名被拒绝 */
  maxTotal: number;
  /** 当前赛季 CS2 图池；报名地图偏好和比赛录入共用这组配置 */
  mapPool: string[];
}

export interface TeamRegistrationConfig {
  allowExternal: boolean;
  graduateCountsAsHome: boolean;
  minHomeMembers: number;
  minEnrolledMembers: number;
  maxExternalMembers: number;
  requirePositions: boolean;
  maxPerPositionPerTeam: number;
  captainCanKick: boolean;
  captainCanTransfer: boolean;
  lockAfterRegistration: boolean;
  requireUniqueTeamName: boolean;
  requireTeamLogo: boolean;
  /** Major-only capability: readiness and strength use this explicitly configured platform context. */
  requireCompetitiveProfile?: boolean;
  competitiveProfile?: CompetitiveProfileConfig;
}

export interface CompetitiveProfileConfig {
  platform: string;
  /**
   * Compatibility slots for frozen 2.0 events. New events also persist an
   * explicit evidencePolicy below; consumers must prefer it when present.
   */
  currentSeasonKey: string;
  previousSeasonKey: string;
  /** Lowest → highest rank labels. Empty means no evaluator is configured yet. */
  rankOrder: string[];
  evidencePolicy?: CompetitiveEvidencePolicy;
  /** Optional event-owned 5E fallback mapping, copied into the registration freeze. */
  fallbackConversion?: CompetitiveFallbackConversion;
  /** 外校最强队员相对本校最强队员的历史最高总星数最大允许差值（默认 3）。 */
  externalStrengthMaxStarGap?: number;
}

/**
 * An audited, event-owned equivalence policy. Mapping is deliberately not
 * product-global: changing it later must not reinterpret an opened event.
 */
export interface CompetitiveFallbackConversion {
  sourcePlatform: "fivee";
  version: string;
  /** Frozen primary-season → source-season correspondence. */
  seasonKeyMap: Record<string, string>;
  rankMap: Record<string, string>;
}

/**
 * The event-owned, immutable policy for consuming platform season facts.
 * `referenceSeasonKey` is the older complete season (20%), while the 30%
 * recent term takes the strongest declared fact among all stable keys in
 * `recentSeasonKeys` (normally the latest complete season plus the ongoing
 * season). The platform catalog continues to own current/previous chronology.
 */
export interface CompetitiveEvidencePolicy {
  historicalWeight: 50;
  referenceSeasonKey: string;
  referenceSeasonWeight: 20;
  recentSeasonKeys: string[];
  recentSeasonWeight: 30;
}

/**
 * Institution-based eligibility is a season capability, not a season.kind
 * branch. `institutionCode` is the MOE canonical code frozen in the preset.
 * Starting-member rules are declared here but match-roster enforcement is a
 * later owner (G1).
 */
export interface InstitutionAffiliationRule {
  institutionCode: string;
  eligibleAcademicStatuses: readonly ("enrolled" | "graduated")[];
  minRosterMembers: number;
  minStartingMembers: number;
}

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

/** Compatibility fallback for historical rows that predate team registration configuration. */
const DEFAULT_TEAM_REGISTRATION_CONFIG: TeamRegistrationConfig = {
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

/**
 * Capability 字段——业务逻辑的唯一判断依据。
 * 禁止用 season.kind 做功能分支，统一读这组字段。
 *
 * @example
 * // ✅ 正确
 * if (season.hasDraft) { ... }
 *
 * // ❌ 禁止
 * if (season.kind === "联赛") { ... }
 */
export interface SeasonCapabilities {
  registrationMode: RegistrationMode;
  hasCaptainVoting: boolean;
  hasDraft: boolean;
  /** 赛事阶段计划；空数组 = 无赛程阶段 */
  stagePlan: StagePlan;
  /** 报名规则配置 */
  registrationConfig: RegistrationConfig;
  teamRegistrationConfig: TeamRegistrationConfig;
  affiliationRules: readonly InstitutionAffiliationRule[];
  maxTeamSize: number;
  minTeamSize: number;
  starterCount: number;
  /** 该赛季可用的位置标识符列表 */
  positions: string[];
}

export interface Season extends SeasonCapabilities {
  id: string;
  slug: string;
  name: string;
  /** 仅用于展示与历史记录，业务逻辑勿用 */
  kind: SeasonKind;
  competitionTemplate: "rivals" | "major" | "custom";
  status: SeasonStatus;
  themeColor: string | null;
  /** 报名开放时间；null 表示赛事已发布但报名时间待定。 */
  registrationOpensAt: Date | null;
  /** 报名实际开放的不可变事实。 */
  registrationOpenedAt: Date | null;
  /** 报名截止时间；超过后不再接受新的报名。 */
  registrationClosesAt: Date | null;
  /** 已有 Entry 最后可自行调整本届名单的时间；null 回退到报名截止。 */
  rosterChangeClosesAt: Date | null;
  /** 赛季结束时间，仅用于展示/归档，不控制报名窗口。 */
  endAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// ── Capability 预设 ───────────────────────────────────────────────────────

export const CS2_POSITIONS = ["igl", "awper", "opener", "closer", "anchor"];
export const DEFAULT_CS2_MAP_POOL = [
  "de_mirage",
  "de_inferno",
  "de_nuke",
  "de_ancient",
  "de_dust2",
  "de_anubis",
  "de_overpass",
] as const;

export const MAP_LABELS: Record<string, string> = {
  de_mirage: "Mirage",
  de_inferno: "Inferno",
  de_nuke: "Nuke",
  de_ancient: "Ancient",
  de_dust2: "Dust2",
  de_anubis: "Anubis",
  de_train: "Train",
  de_cache: "Cache",
  de_overpass: "Overpass",
  de_vertigo: "Vertigo",
};

export const MAP_PREFERENCE_LEVELS: readonly MapPreferenceLevel[] = [
  "none",
  "basic",
  "playable",
  "proficient",
  "strong",
] as const;

export const MAP_PREFERENCE_LABELS: Record<MapPreferenceLevel, string> = {
  none: "不会",
  basic: "认路",
  playable: "能打",
  proficient: "熟练",
  strong: "强图",
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
  mapPool: [...DEFAULT_CS2_MAP_POOL],
};

/** 选秀联赛预设：个人报名 → 队长投票 → 蛇形选秀 → 循环赛 + 双败淘汰 */
const DRAFT_LEAGUE_PRESET: SeasonCapabilities = {
  registrationMode: "solo",
  hasCaptainVoting: true,
  hasDraft: true,
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
  positions: CS2_POSITIONS,
};

/** 公开赛预设：自由组队报名 → 循环赛 + 双败淘汰 */
export const OPEN_TOURNAMENT_PRESET: SeasonCapabilities = {
  registrationMode: "team",
  hasCaptainVoting: false,
  hasDraft: false,
  stagePlan: RIVALS_STAGE_PLAN,
  registrationConfig: RIVALS_REGISTRATION_CONFIG,
  teamRegistrationConfig: { ...MAJOR_TEAM_CONFIG, requireTeamLogo: false },
  affiliationRules: [],
  maxTeamSize: 5,
  minTeamSize: 5,
  starterCount: 5,
  positions: CS2_POSITIONS,
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

/** 所有预设的快捷索引 */
export const CAPABILITY_PRESETS = {
  "draft-league": DRAFT_LEAGUE_PRESET,
  "open-tournament": OPEN_TOURNAMENT_PRESET,
  major: {
    registrationMode: "team" as const,
    hasCaptainVoting: false,
    hasDraft: false,
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
    positions: CS2_POSITIONS,
  },
} as const;

/** @alias Compatibility name retained for existing admin/test consumers. */
export const RIVALS_DEFAULT_CAPABILITIES = DRAFT_LEAGUE_PRESET;
export const MAJOR_DEFAULT_CAPABILITIES = CAPABILITY_PRESETS.major;

/**
 * 返回一份可安全编辑的 Major 能力配置副本。
 *
 * 预设常量是标准规则的唯一来源；表单不能直接持有或修改该常量。
 */
export function createMajorDefaultCapabilities(): SeasonCapabilities {
  return structuredClone(MAJOR_DEFAULT_CAPABILITIES) as SeasonCapabilities;
}

export const PLAYER_TYPE_LABELS: Record<PlayerType, string> = {
  enrolled: "在校",
  graduated: "毕业",
  external: "外校",
};

export const STAGE_TYPE_LABELS: Record<StageType, string> = {
  round_robin: "单循环",
  double_elim: "双败淘汰",
  single_elim: "单败淘汰",
  swiss: "瑞士轮",
};

type PartialRegistrationConfig = Partial<Omit<RegistrationConfig, "rankThreshold">> & {
  rankThreshold?: Partial<RegistrationConfig["rankThreshold"]>;
};

export function normalizeRegistrationConfig(
  config: PartialRegistrationConfig | null | undefined,
): RegistrationConfig {
  const currentMin =
    config?.rankThreshold?.currentMin === undefined
      ? RIVALS_REGISTRATION_CONFIG.rankThreshold.currentMin
      : config.rankThreshold.currentMin;
  const peakMin =
    config?.rankThreshold?.peakMin === undefined
      ? RIVALS_REGISTRATION_CONFIG.rankThreshold.peakMin
      : config.rankThreshold.peakMin;

  return {
    allowedPlayerTypes:
      config?.allowedPlayerTypes?.length ? config.allowedPlayerTypes : RIVALS_REGISTRATION_CONFIG.allowedPlayerTypes,
    rankThreshold: {
      currentMin,
      peakMin,
    },
    maxPerPosition: config?.maxPerPosition ?? RIVALS_REGISTRATION_CONFIG.maxPerPosition,
    screenshotCount: config?.screenshotCount ?? RIVALS_REGISTRATION_CONFIG.screenshotCount,
    maxTotal: config?.maxTotal ?? RIVALS_REGISTRATION_CONFIG.maxTotal,
    mapPool: config?.mapPool?.length ? [...new Set(config.mapPool)] : RIVALS_REGISTRATION_CONFIG.mapPool,
  };
}

type PartialTeamConfig = Partial<TeamRegistrationConfig>;

export function normalizeTeamRegistrationConfig(
  config: PartialTeamConfig | null | undefined,
): TeamRegistrationConfig {
  return {
    allowExternal: config?.allowExternal ?? DEFAULT_TEAM_REGISTRATION_CONFIG.allowExternal,
    graduateCountsAsHome: config?.graduateCountsAsHome ?? DEFAULT_TEAM_REGISTRATION_CONFIG.graduateCountsAsHome,
    minHomeMembers: config?.minHomeMembers ?? DEFAULT_TEAM_REGISTRATION_CONFIG.minHomeMembers,
    minEnrolledMembers: config?.minEnrolledMembers ?? DEFAULT_TEAM_REGISTRATION_CONFIG.minEnrolledMembers,
    maxExternalMembers: config?.maxExternalMembers ?? DEFAULT_TEAM_REGISTRATION_CONFIG.maxExternalMembers,
    requirePositions: config?.requirePositions ?? DEFAULT_TEAM_REGISTRATION_CONFIG.requirePositions,
    maxPerPositionPerTeam: config?.maxPerPositionPerTeam ?? DEFAULT_TEAM_REGISTRATION_CONFIG.maxPerPositionPerTeam,
    captainCanKick: config?.captainCanKick ?? DEFAULT_TEAM_REGISTRATION_CONFIG.captainCanKick,
    captainCanTransfer: config?.captainCanTransfer ?? DEFAULT_TEAM_REGISTRATION_CONFIG.captainCanTransfer,
    lockAfterRegistration: config?.lockAfterRegistration ?? DEFAULT_TEAM_REGISTRATION_CONFIG.lockAfterRegistration,
    requireUniqueTeamName: config?.requireUniqueTeamName ?? DEFAULT_TEAM_REGISTRATION_CONFIG.requireUniqueTeamName,
    requireTeamLogo: config?.requireTeamLogo ?? false,
    requireCompetitiveProfile: config?.requireCompetitiveProfile ?? false,
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
              }
            : undefined,
          fallbackConversion: config.competitiveProfile.fallbackConversion
            ? {
                sourcePlatform: "fivee",
                version: config.competitiveProfile.fallbackConversion.version.trim(),
                seasonKeyMap: Object.fromEntries(Object.entries(config.competitiveProfile.fallbackConversion.seasonKeyMap)
                  .map(([primary, source]) => [primary.trim(), source.trim()])
                  .filter(([primary, source]) => primary && source)),
                rankMap: Object.fromEntries(Object.entries(config.competitiveProfile.fallbackConversion.rankMap)
                  .map(([source, target]) => [source.trim(), target.trim()])
                  .filter(([source, target]) => source && target)),
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
  return stagePlan ?? RIVALS_STAGE_PLAN;
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
