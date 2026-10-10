// Season capability 工具函数
// 所有判断均基于 season capability 字段，禁止读取 season.kind

import { type Season } from "@/types/season";

// ── 阶段判断（基于 status）────────────────────────────────────────────────

/** 是否为个人报名模式 */
export function isSoloRegistration(season: Pick<Season, "registrationMode">): boolean {
  return season.registrationMode === "solo";
}

/** 是否为队伍整体报名模式 */
export function isTeamRegistration(season: Pick<Season, "registrationMode">): boolean {
  return season.registrationMode === "team";
}

// ── 展示工具 ──────────────────────────────────────────────────────────────

/** Formal match facts include qualification while the event is still registering. */
export function showStats(season: Pick<Season, "status"> & { hasOfficialMatches?: boolean }): boolean {
  return season.status !== "draft" && (season.hasOfficialMatches === true || season.status === "playing" || season.status === "finished" || season.status === "archived");
}
