import type { SemanticTone, StatusPresentation } from "@/lib/presentation";
import type { PlayerType, SeasonStatus, StageConfig, StageType } from "@/types/season";
import type { CompetitionTemplate } from "@/lib/competition/templates";
import { getRegistrationWindowState, type RegistrationWindowSeason } from "@/lib/registration/window";
import { formatCSTDateTime } from "@/lib/utils/date";

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

export const PLAYER_TYPE_LABELS: Record<PlayerType, string> = {
  enrolled: "在校",
  graduated: "毕业",
  external: "外校",
};

export const STAGE_TYPE_LABELS: Record<StageType, string> = {
  round_robin: "单循环",
  double_elim: "双败淘汰",
  single_elim: "单败淘汰",
  swiss: "瑞士轮",
};

const SEASON_STATUS_PRESENTATIONS: Record<SeasonStatus, StatusPresentation> = {
  draft: { label: "草稿", tone: "neutral" },
  registration: { label: "已发布", tone: "success" },
  voting: { label: "投票中", tone: "warn" },
  drafting: { label: "选秀中", tone: "accent" },
  playing: { label: "比赛中", tone: "accent" },
  finished: { label: "已结束", tone: "neutral" },
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

/** Concise lifecycle-specific copy for discovery cards; it never infers match state. */
export function presentSeasonDirectoryActivity(
  season: Pick<SeasonLifecycleInput, "status">,
  nextStageName?: string | null,
): string | null {
  switch (season.status) {
    case "voting":
      return "队长投票正在进行";
    case "drafting":
      return "选秀正在进行";
    case "playing":
      return nextStageName ? `赛程进行中 · ${nextStageName}` : "赛程正在进行";
    default:
      return null;
  }
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

/** Shared public copy for registration schedules. Window state remains owned
 * by registration/window; this only turns that fact into display-ready text. */
export interface RegistrationSchedulePresentation {
  primary: string;
  secondary: string | null;
  countdownTarget: string | null;
}

export function presentRegistrationSchedule(
  season: RegistrationWindowSeason,
  now: Date = new Date(),
): RegistrationSchedulePresentation | null {
  if (season.status !== "registration") return null;

  const window = getRegistrationWindowState(season, now);
  const opensAt = season.registrationOpensAt;
  const closesAt = season.registrationClosesAt;

  switch (window.phase) {
    case "unscheduled":
      return { primary: "报名开放时间待定", secondary: null, countdownTarget: null };
    case "upcoming":
      return {
        primary: opensAt ? `${formatCSTDateTime(opensAt)} 开放报名` : "报名开放时间待定",
        secondary: closesAt ? `${formatCSTDateTime(closesAt)} 截止` : null,
        countdownTarget: opensAt ? new Date(opensAt).toISOString() : null,
      };
    case "open":
      return {
        primary: closesAt ? `${formatCSTDateTime(closesAt)} 截止` : "报名中",
        secondary: null,
        countdownTarget: closesAt ? new Date(closesAt).toISOString() : null,
      };
    case "closed":
      return {
        primary: closesAt ? `报名已于 ${formatCSTDateTime(closesAt)} 截止` : "报名已截止",
        secondary: null,
        countdownTarget: null,
      };
    default:
      return null;
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
