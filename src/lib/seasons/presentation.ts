import type { StatusPresentation } from "@/lib/presentation";
import type { SeasonStatus } from "@/types/season";

const SEASON_STATUS_PRESENTATIONS: Record<SeasonStatus, StatusPresentation> = {
  draft: { label: "草稿", tone: "neutral" },
  registration: { label: "报名开放", tone: "success" },
  voting: { label: "投票中", tone: "warn" },
  drafting: { label: "选秀中", tone: "accent" },
  playing: { label: "LIVE", tone: "danger" },
  finished: { label: "FT", tone: "neutral" },
  archived: { label: "已归档", tone: "neutral" },
};

export function presentSeasonStatus(status: SeasonStatus): StatusPresentation {
  return SEASON_STATUS_PRESENTATIONS[status];
}
