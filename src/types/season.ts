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
export type QualifierFormat = "round_robin" | "swiss";
export type PlayoffFormat = "double_elim" | "single_elim";

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
  /** 排位赛赛制；null = 无排位赛阶段 */
  qualifierFormat: QualifierFormat | null;
  /** 正赛赛制；null = 无正赛阶段（如纯排位赛娱乐赛）*/
  playoffFormat: PlayoffFormat | null;
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

/** 选秀联赛预设：个人报名 → 队长投票 → 蛇形选秀 → 循环赛 + 双败淘汰 */
export const DRAFT_LEAGUE_PRESET: SeasonCapabilities = {
  registrationMode: "solo",
  hasCaptainVoting: true,
  hasDraft: true,
  qualifierFormat: "round_robin",
  playoffFormat: "double_elim",
  teamSize: 7,
  starterCount: 5,
  positions: CS2_POSITIONS,
};

/** 公开赛预设：自由组队报名 → 循环赛 + 双败淘汰 */
export const OPEN_TOURNAMENT_PRESET: SeasonCapabilities = {
  registrationMode: "team",
  hasCaptainVoting: false,
  hasDraft: false,
  qualifierFormat: "round_robin",
  playoffFormat: "double_elim",
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
