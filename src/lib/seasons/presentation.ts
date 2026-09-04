import type { SemanticTone, StatusPresentation } from "@/lib/presentation";
import type { SeasonStatus, StageConfig } from "@/types/season";
import type { CompetitionTemplate } from "@/lib/competition/templates";
import { getRegistrationWindowState, type RegistrationWindowSeason } from "@/lib/registration/window";

export type SeasonLifecycleGroup = "active" | "upcoming" | "draft" | "recent" | "archived";

export interface SeasonLifecycleInput {
  status: SeasonStatus;
  registrationOpenedAt?: Date | string | null;
}

export interface SeasonLifecycleGroupDefinition {
  key: SeasonLifecycleGroup;
  label: string;
  marker: string;
  tone: SemanticTone;
}

/** Presentation-only directory groups. They never become a persisted season fact. */
export const SEASON_LIFECYCLE_GROUPS: readonly SeasonLifecycleGroupDefinition[] = [
  { key: "active", label: "进行中", marker: "ACTIVE", tone: "success" },
  { key: "upcoming", label: "即将开始", marker: "UPCOMING", tone: "warn" },
  { key: "draft", label: "草稿", marker: "DRAFT", tone: "neutral" },
  { key: "recent", label: "最近结束", marker: "RECENT", tone: "neutral" },
  { key: "archived", label: "已归档", marker: "ARCHIVE", tone: "neutral" },
];

const SEASON_STATUS_PRESENTATIONS: Record<SeasonStatus, StatusPresentation> = {
  draft: { label: "草稿", tone: "neutral" },
  registration: { label: "已发布", tone: "success" },
  voting: { label: "投票中", tone: "warn" },
  drafting: { label: "选秀中", tone: "accent" },
  playing: { label: "LIVE", tone: "danger" },
  finished: { label: "FT", tone: "neutral" },
  archived: { label: "已归档", tone: "neutral" },
};

export function presentSeasonStatus(status: SeasonStatus): StatusPresentation {
  return SEASON_STATUS_PRESENTATIONS[status];
}

/** The persisted registration transition is the only fact that makes a
 * published registration season operationally active for this directory. */
export function isRegistrationActuallyOpen(season: SeasonLifecycleInput): boolean {
  return season.status === "registration" && season.registrationOpenedAt != null;
}

export function getSeasonLifecycleGroup(season: SeasonLifecycleInput): SeasonLifecycleGroup {
  if (season.status === "archived") return "archived";
  if (season.status === "finished") return "recent";
  if (season.status === "draft") return "draft";
  if (season.status === "registration" && !isRegistrationActuallyOpen(season)) {
    return "upcoming";
  }
  return "active";
}

export function presentSeasonLifecycle(season: SeasonLifecycleInput): StatusPresentation {
  const group = SEASON_LIFECYCLE_GROUPS.find((definition) => definition.key === getSeasonLifecycleGroup(season));
  if (!group) throw new Error("Unknown season lifecycle group");
  return { label: group.label, tone: group.tone };
}

/** Compact status text for directory cards; keep the pre-open distinction
 * visible instead of collapsing it into the generic published label. */
export function presentSeasonLifecycleSummary(season: SeasonLifecycleInput): string {
  if (season.status === "registration" && !isRegistrationActuallyOpen(season)) {
    return "已发布 · 报名未开放";
  }
  return presentSeasonStatus(season.status).label;
}

export function groupSeasonsByLifecycle<T extends SeasonLifecycleInput>(
  seasons: readonly T[],
): Record<SeasonLifecycleGroup, T[]> {
  const grouped: Record<SeasonLifecycleGroup, T[]> = {
    active: [],
    upcoming: [],
    draft: [],
    recent: [],
    archived: [],
  };

  for (const season of seasons) {
    grouped[getSeasonLifecycleGroup(season)].push(season);
  }

  return grouped;
}

/** Public participation label for a published Season; lifecycle status stays
 * separate so non-registration phases continue to use their canonical label. */
export function presentSeasonParticipationState(season: RegistrationWindowSeason): StatusPresentation {
  if (season.status !== "registration") return presentSeasonStatus(season.status);
  switch (getRegistrationWindowState(season).phase) {
    case "unscheduled": return { label: "报名时间待定", tone: "neutral" };
    case "upcoming": return { label: "即将开放", tone: "warn" };
    case "open": return { label: "报名中", tone: "success" };
    case "closed": return { label: "报名已截止", tone: "neutral" };
    default: return presentSeasonStatus(season.status);
  }
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
