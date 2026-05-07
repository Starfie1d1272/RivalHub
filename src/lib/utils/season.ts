// TODO: 实现赛季工具函数
// - isRegistrationOpen(season)：赛季是否处于报名阶段
// - isVotingOpen(season)：赛季是否处于投票阶段
// - isDraftActive(season)：赛季是否处于选秀阶段
// - getSeasonPhaseLabel(season)：返回当前阶段的中文标签

import type { Season } from "@/types/season";

export function isRegistrationOpen(_season: Season): boolean {
  throw new Error("not implemented");
}

export function isVotingOpen(_season: Season): boolean {
  throw new Error("not implemented");
}

export function isDraftActive(_season: Season): boolean {
  throw new Error("not implemented");
}

export function getSeasonPhaseLabel(_season: Season): string {
  throw new Error("not implemented");
}
