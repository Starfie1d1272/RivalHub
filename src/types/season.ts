// 共享赛季类型——与 Drizzle schema 对齐

import type { ConversionPolicyMapping } from "@/lib/competitive/conversion-policy";

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

/**
 * Editable/presentation map preference. `null` means the user has not made a
 * declaration; it must never be persisted as the explicit `none` level.
 */
export interface MapPreferenceDraft {
  map: string;
  level: MapPreferenceLevel | null;
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
  /** Event-owned CS2 map pool; solo registration and match entry consume this frozen config. */
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
  /** Optional event-owned 5E equivalence mapping, copied into the registration freeze; the field name remains for legacy snapshots. */
  fallbackConversion?: CompetitiveFallbackConversion;
  /** 外校最强队员相对本校最强队员的历史最高总星数最大允许差值（默认 3）。 */
  externalStrengthMaxStarGap?: number;
  /** Selected ConversionPolicy version (e.g. "2026.09"); fixed at publish. */
  conversionPolicyVersion?: string;
  /** Selected ConversionPolicy stable id; fixed at publish. */
  conversionPolicyId?: string;
}

type CompetitiveSourceSelection = "primary_then_fallback" | "strongest_equivalent";

/**
 * An audited, event-owned equivalence policy. Mapping is deliberately not
 * product-global: changing it later must not reinterpret an opened event.
 */
export interface CompetitiveFallbackConversion {
  sourcePlatform: "fivee";
  version: string;
  /** Frozen primary-season → source-season correspondence (positional). */
  seasonKeyMap: Record<string, string>;
  /** Star-level conversion mapping (below-S rank map + S-tier star segments). */
  mapping?: ConversionPolicyMapping;
  /** Legacy rank-level conversion map for historical frozen events. */
  rankMap?: Record<string, string>;
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
  /** Legacy snapshots omit this and retain primary-first semantics. */
  sourceSelection?: CompetitiveSourceSelection;
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
  hasCommunityAwards: boolean;
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
