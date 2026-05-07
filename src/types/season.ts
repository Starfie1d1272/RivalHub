// 共享赛季类型——与 Drizzle schema 枚举对齐

export type SeasonKind = "rivals" | "major";

export type SeasonStatus =
  | "draft"
  | "registration"
  | "voting"
  | "drafting"
  | "playing"
  | "finished"
  | "archived";

export interface Season {
  id: string;
  slug: string;
  name: string;
  kind: SeasonKind;
  status: SeasonStatus;
  themeColor: string | null;
  startAt: Date | null;
  endAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** 状态标签（中文，用于 UI 展示） */
export const SEASON_STATUS_LABELS: Record<SeasonStatus, string> = {
  draft: "未发布",
  registration: "报名中",
  voting: "投票中",
  drafting: "选秀中",
  playing: "进行中",
  finished: "已结束",
  archived: "已归档",
};
