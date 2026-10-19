import type { MajorPrestartReadiness } from "@/lib/major/prestart";
import type { SeasonStatus } from "@/types/season";
import type { SeasonWorkspaceNextAction, SeasonWorkspaceOverviewSummary, SeasonWorkspaceTeamRegistrationFunnel } from "./types";

export interface SeasonWorkspaceLifecycleInput {
  slug: string;
  status: SeasonStatus;
  registrationOpenedAt: Date | null;
}

export interface RegistrationSummaryRow {
  status: string;
  count: number;
}

export function projectTeamRegistrationFunnel(
  rows: readonly RegistrationSummaryRow[],
  input: Pick<SeasonWorkspaceTeamRegistrationFunnel, "deadline" | "windowPhase">,
): SeasonWorkspaceTeamRegistrationFunnel {
  const statusCounts = new Map<string, number>();
  for (const row of rows) statusCounts.set(row.status, (statusCounts.get(row.status) ?? 0) + row.count);
  return {
    mode: "team",
    total: [...statusCounts.values()].reduce((sum, value) => sum + value, 0),
    draft: statusCounts.get("draft") ?? 0,
    submitted: statusCounts.get("submitted") ?? 0,
    approved: statusCounts.get("approved") ?? 0,
    deadline: input.deadline,
    windowPhase: input.windowPhase,
  };
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
      label: "查看结果与荣誉",
      detail: season.status === "archived" ? "赛事已归档，可进入结果与荣誉查看收尾记录。" : "赛事已结束，可进行官方收尾。",
      href: `/admin/${season.slug}/post-event`,
    };
  }

  if (season.status === "playing") {
    if (summary.scheduledMatchesWithoutConfirmedLineups > 0 || summary.matchCount > 0) {
      return {
        label: "进入比赛执行",
        detail: summary.scheduledMatchesWithoutConfirmedLineups > 0
          ? `${summary.scheduledMatchesWithoutConfirmedLineups} 场已排期比赛等待名单确认。`
          : `${summary.matchCount} 场比赛可在比赛执行中查看。`,
        href: `/admin/${season.slug}/matches`,
      };
    }
    return { label: "编排赛事赛程", detail: "赛事已开赛，可生成赛程并推进当前阶段。", href: `/admin/${season.slug}/matches?view=schedule` };
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

    if (readiness && !readiness.canStart) {
      return {
        label: "继续开赛筹备",
        detail: "开赛筹备仍有事项需要处理。",
        href: `/admin/${season.slug}/prestart`,
      };
    }

    return { label: "进入开赛筹备", detail: "报名窗口已开放，可继续准备赛事运营流程。", href: `/admin/${season.slug}/prestart` };
  }

  if (season.status === "draft") {
    return { label: "准备赛事", detail: "赛事尚未发布，可从开赛筹备检查当前条件。", href: `/admin/${season.slug}/prestart` };
  }

  return readiness && !readiness.canStart
    ? { label: "继续开赛筹备", detail: "开赛筹备仍有事项需要处理。", href: `/admin/${season.slug}/prestart` }
    : { label: "进入开赛筹备", detail: "从赛事工作区继续当前运营流程。", href: `/admin/${season.slug}/prestart` };
}
