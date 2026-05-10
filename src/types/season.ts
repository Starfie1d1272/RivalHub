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
  hasThirdPlaceMatch?: boolean;
  seeds?: number[];
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
  /** 赛事阶段计划；空数组 = 无赛程阶段 */
  stagePlan: StagePlan;
  /** 报名规则配置 */
  registrationConfig: RegistrationConfig;
  teamSize: number;
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
  status: SeasonStatus;
  themeColor: string | null;
  startAt: Date | null;
  endAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// ── Capability 预设 ───────────────────────────────────────────────────────

export const CS2_POSITIONS = ["igl", "awper", "opener", "closer", "anchor"];

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
  },
];

export const RIVALS_REGISTRATION_CONFIG: RegistrationConfig = {
  allowedPlayerTypes: ["enrolled"],
  rankThreshold: { currentMin: "A", peakMin: "A+" },
  maxPerPosition: 15,
  screenshotCount: 1,
};

/** 选秀联赛预设：个人报名 → 队长投票 → 蛇形选秀 → 循环赛 + 双败淘汰 */
export const DRAFT_LEAGUE_PRESET: SeasonCapabilities = {
  registrationMode: "solo",
  hasCaptainVoting: true,
  hasDraft: true,
  stagePlan: RIVALS_STAGE_PLAN,
  registrationConfig: RIVALS_REGISTRATION_CONFIG,
  teamSize: 7,
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
  teamSize: 5,
  starterCount: 5,
  positions: CS2_POSITIONS,
};

/** 所有预设的快捷索引 */
export const CAPABILITY_PRESETS = {
  "draft-league": DRAFT_LEAGUE_PRESET,
  "open-tournament": OPEN_TOURNAMENT_PRESET,
} as const;

// 向后兼容别名
export const RIVALS_DEFAULT_CAPABILITIES = DRAFT_LEAGUE_PRESET;
export const MAJOR_DEFAULT_CAPABILITIES = OPEN_TOURNAMENT_PRESET;

// ── 展示标签 ─────────────────────────────────────────────────────────────

export const SEASON_STATUS_LABELS: Record<SeasonStatus, string> = {
  draft: "未发布",
  registration: "报名中",
  voting: "投票中",
  drafting: "选秀中",
  playing: "进行中",
  finished: "已结束",
  archived: "已归档",
};

export const SEASON_STATUS_TONE: Record<SeasonStatus, "live" | "soon" | "done"> = {
  draft:        "soon",
  registration: "live",
  voting:       "live",
  drafting:     "live",
  playing:      "live",
  finished:     "done",
  archived:     "done",
};

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
  };
}

export function normalizeStagePlan(stagePlan: StagePlan | null | undefined): StagePlan {
  const plan = stagePlan ?? RIVALS_STAGE_PLAN;
  return plan.map((stage) => {
    // 兼容旧 advance 字段：自动转换为 advanceTiers
    const raw = stage as StageConfig & { advance?: number };
    if (raw.advance !== undefined && (!raw.advanceTiers || raw.advanceTiers.length === 0)) {
      return {
        ...stage,
        advanceTiers: [{ placement: "*", count: raw.advance }],
      };
    }
    return stage;
  });
}

export function getStageByKey(stagePlan: StagePlan | null | undefined, key: string): StageConfig | null {
  return normalizeStagePlan(stagePlan).find((stage) => stage.key === key) ?? null;
}

export function getFirstStage(stagePlan: StagePlan | null | undefined): StageConfig | null {
  return normalizeStagePlan(stagePlan)[0] ?? null;
}

export function getNextStage(stagePlan: StagePlan | null | undefined, key: string): StageConfig | null {
  const stages = normalizeStagePlan(stagePlan);
  const index = stages.findIndex((stage) => stage.key === key);
  return index >= 0 ? stages[index + 1] ?? null : null;
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
