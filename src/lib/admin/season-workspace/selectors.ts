import type { MajorPrestartReadiness } from "@/lib/major/prestart";
import type { SeasonStatus } from "@/types/season";
import type { SeasonWorkspaceNextAction, SeasonWorkspaceOverviewSummary } from "./types";

export interface SeasonWorkspaceLifecycleInput {
  slug: string;
  status: SeasonStatus;
  registrationOpenedAt: Date | null;
}

export interface RegistrationSummaryRow {
  status: string;
  count: number;
}

export function projectRegistrationSummary(
  registrationMode: "solo" | "team",
  rows: readonly RegistrationSummaryRow[],
  formedTeamCount: number,
): Pick<SeasonWorkspaceOverviewSummary, "pendingApplications" | "approvedEntries" | "formedTeamCount"> {
  const statusCounts = new Map(rows.map((row) => [row.status, row.count]));
  const approvedEntries = statusCounts.get("approved") ?? 0;
  return {
    pendingApplications: statusCounts.get(registrationMode === "team" ? "submitted" : "pending") ?? 0,
    approvedEntries,
    formedTeamCount: registrationMode === "team" ? approvedEntries : formedTeamCount,
  };
}

export function selectSeasonWorkspaceNextAction(
  season: SeasonWorkspaceLifecycleInput,
  summary: SeasonWorkspaceOverviewSummary,
  readiness: MajorPrestartReadiness | null,
): SeasonWorkspaceNextAction {
  if (season.status === "finished" || season.status === "archived") {
    return {
      label: "查看赛后工作区",
      detail: season.status === "archived" ? "赛事已归档，可进入赛后工作区查看收尾记录。" : "赛事已结束，可进行官方收尾。",
      href: `/admin/${season.slug}/post-event`,
    };
  }

  if (season.status === "playing") {
    if (summary.scheduledMatchesWithoutConfirmedLineups > 0 || summary.matchCount > 0) {
      return {
        label: "查看比赛工作区",
        detail: summary.scheduledMatchesWithoutConfirmedLineups > 0
          ? `${summary.scheduledMatchesWithoutConfirmedLineups} 场已排期比赛等待名单确认。`
          : `${summary.matchCount} 场比赛已进入赛事工作区。`,
        href: `/admin/${season.slug}/matches`,
      };
    }
    return { label: "处理赛前检查", detail: "赛事已进入进行阶段，但尚未形成比赛工作项。", href: `/admin/${season.slug}/prestart` };
  }

  if (season.status === "registration") {
    if (summary.pendingApplications > 0) {
      return {
        label: "处理报名审核",
        detail: `${summary.pendingApplications} 份报名等待管理员处理。`,
        href: `/admin/${season.slug}/registrations`,
      };
    }

    if (season.registrationOpenedAt === null) {
      return { label: "准备报名入口", detail: "赛事已发布，但报名尚未实际开放。", href: `/admin/${season.slug}/registrations` };
    }

    const readinessBlocker = readiness?.blockers[0];
    if (readinessBlocker) {
      return {
        label: "处理赛前检查",
        detail: readinessBlocker,
        href: `/admin/${season.slug}/prestart`,
      };
    }

    return { label: "查看赛前工作区", detail: "报名窗口已开放，可继续准备赛事运营流程。", href: `/admin/${season.slug}/prestart` };
  }

  if (season.status === "draft") {
    return { label: "准备赛事", detail: "赛事尚未发布，可从赛前工作区检查当前能力。", href: `/admin/${season.slug}/prestart` };
  }

  const readinessBlocker = readiness?.blockers[0];
  return readinessBlocker
    ? { label: "处理赛前检查", detail: readinessBlocker, href: `/admin/${season.slug}/prestart` }
    : { label: "查看赛前工作区", detail: "从赛事工作区继续当前运营流程。", href: `/admin/${season.slug}/prestart` };
}
