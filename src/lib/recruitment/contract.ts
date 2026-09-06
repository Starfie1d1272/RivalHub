import type { Cs2Position } from "@/lib/config/cs2-positions";

export type RecruitmentTeamSize = "small" | "medium" | "large";

export interface RecruitmentFilters {
  q?: string;
  position?: Cs2Position;
  targetSeasonId?: string;
  teamSize?: RecruitmentTeamSize;
  map?: string;
}
