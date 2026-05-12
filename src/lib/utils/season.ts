// Season capability 工具函数
// 所有判断均基于 season capability 字段，禁止读取 season.kind

import { getFirstStageOfType, normalizeStagePlan, type Season } from "@/types/season";

// ── 阶段判断（基于 status）────────────────────────────────────────────────

export function isRegistrationOpen(season: Season): boolean {
  return season.status === "registration";
}

export function isVotingOpen(season: Season): boolean {
  return season.status === "voting";
}

export function isDraftActive(season: Season): boolean {
  return season.status === "drafting";
}

export function isPlaying(season: Season): boolean {
  return season.status === "playing";
}

// ── Capability 判断（路由守卫、UI 条件渲染的唯一入口）─────────────────────

/** 是否展示队长投票入口 */
export function showCaptainVoting(season: Season): boolean {
  return season.hasCaptainVoting;
}

/** 是否展示蛇形选秀入口 */
export function showDraft(season: Season): boolean {
  return season.hasDraft;
}

/** 是否展示排位赛视图 */
export function showQualifier(season: Season): boolean {
  return !!getFirstStageOfType(season.stagePlan, ["round_robin", "swiss"]);
}

/** 是否展示正赛 Bracket 视图 */
export function showPlayoffBracket(season: Season): boolean {
  return !!getFirstStageOfType(season.stagePlan, ["double_elim", "single_elim"]);
}

export function showMatches(season: Season): boolean {
  return normalizeStagePlan(season.stagePlan).length > 0;
}

/** 是否为个人报名模式 */
export function isSoloRegistration(season: Season): boolean {
  return season.registrationMode === "solo";
}

// ── 展示工具 ──────────────────────────────────────────────────────────────

/** 是否展示数据统计入口（赛季 playing 或 finished 时有比赛数据可看） */
export function showStats(season: Season): boolean {
  return season.status === "playing" || season.status === "finished" || season.status === "archived";
}
