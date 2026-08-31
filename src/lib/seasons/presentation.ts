import type { StatusPresentation } from "@/lib/presentation";
import type { SeasonStatus, StageConfig } from "@/types/season";
import type { CompetitionTemplate } from "@/lib/competition/templates";

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

const MAJOR_STAGE_MARKERS: Record<string, string> = {
  stage1: "STAGE1",
  stage2: "STAGE2",
  stage3: "STAGE3",
  playoff: "PLAYOFF",
};

/** 首页阶段轨道使用独立的短标记，不将 stage key 直接作为 UI 文案。 */
export function presentStageMarker(stage: Pick<StageConfig, "key" | "name">, competitionTemplate: CompetitionTemplate): string {
  return competitionTemplate === "major" ? (MAJOR_STAGE_MARKERS[stage.key] ?? stage.name) : stage.name;
}
