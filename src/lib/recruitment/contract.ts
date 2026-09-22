import { applyListQueryUpdates } from "@/lib/list-query";
import type { Cs2Position } from "@/lib/config/cs2-positions";

export type RecruitmentTeamSize = "small" | "medium" | "large";

export interface RecruitmentFilters {
  q?: string;
  position?: Cs2Position;
  targetSeasonId?: string;
  teamSize?: RecruitmentTeamSize;
  map?: string;
}

export function resolveRecruitmentView(explicit: string | undefined, hasOpenLft: boolean, isCaptain: boolean): "teams" | "players" {
  if (explicit === "teams" || explicit === "players") return explicit;
  return hasOpenLft ? "teams" : isCaptain ? "players" : "teams";
}

export function recruitmentHref(view: "teams" | "players", filters: RecruitmentFilters = {}): `/teams/recruitment?${string}` {
  const query = applyListQueryUpdates(new URLSearchParams(), { view, event: filters.targetSeasonId, q: filters.q, position: filters.position, size: filters.teamSize, map: filters.map });
  return `/teams/recruitment?${query.toString()}`;
}
