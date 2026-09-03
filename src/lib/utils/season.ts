// Season capability 工具函数
// 所有判断均基于 season capability 字段，禁止读取 season.kind

import { type Season } from "@/types/season";

// ── 阶段判断（基于 status）────────────────────────────────────────────────

/** 是否为个人报名模式 */
export function isSoloRegistration(season: Season): boolean {
  return season.registrationMode === "solo";
}

/** 是否为队伍整体报名模式 */
export function isTeamRegistration(season: Season): boolean {
  return season.registrationMode === "team";
}

// ── 展示工具 ──────────────────────────────────────────────────────────────

/** 是否展示数据统计入口（赛季 playing 或 finished 时有比赛数据可看） */
export function showStats(season: Season): boolean {
  return season.status === "playing" || season.status === "finished" || season.status === "archived";
}
