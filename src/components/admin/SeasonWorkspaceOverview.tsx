import React from "react";
import Link from "next/link";
import { Marker, Panel, StatusPill } from "@/components/rivalhub";
import { AdminExceptionSummary } from "@/components/admin/AdminExceptionSummary";
import { Button } from "@/components/ui/button";
import { presentSeasonLifecycle, presentSeasonLifecycleSummary, presentSeasonStatus } from "@/lib/seasons/presentation";
import { formatCST } from "@/lib/utils/date";
import type { SeasonWorkspaceOverviewData } from "@/lib/admin/season-workspace/types";

function formatDate(value: Date | null): string {
  if (!value) return "未配置";
  return formatCST(value);
}

export function SeasonWorkspaceOverview({ data }: { data: SeasonWorkspaceOverviewData }) {
  const { season, summary, readiness, nextAction } = data;
  const lifecycle = presentSeasonLifecycle(season);
  const status = presentSeasonStatus(season.status);
  const isTeamRegistration = season.registrationMode === "team";
  const stats = [
    { label: "待审核报名", value: summary.pendingApplications },
    { label: "已批准报名", value: summary.approvedEntries },
    { label: isTeamRegistration ? "正式参赛队" : "已形成队伍", value: isTeamRegistration ? `${summary.frozenEntrantCount}/${summary.entrantCount}` : summary.formedTeamCount },
    { label: "比赛", value: summary.matchCount },
  ];

  return (
    <div className="space-y-5">
      <Marker sub={`${lifecycle.label} · ${presentSeasonLifecycleSummary(season)}`} action={<StatusPill {...status} />}>
        {season.name}
      </Marker>

      <Panel label="赛事概览">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label} className="border border-[var(--color-border)] px-3 py-3">
              <p className="text-xs text-[var(--color-fg-mid)]">{stat.label}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-[var(--color-fg)]">{stat.value}</p>
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
        <Panel label="生命周期与时间">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-[var(--color-fg-mid)]">当前阶段</dt><dd className="mt-1 font-medium">{status.label}</dd></div>
            <div><dt className="text-[var(--color-fg-mid)]">实际报名开放</dt><dd className="mt-1 font-medium">{formatDate(season.registrationOpenedAt)}</dd></div>
            <div><dt className="text-[var(--color-fg-mid)]">计划开放时间</dt><dd className="mt-1 font-medium">{formatDate(season.registrationOpensAt)}</dd></div>
            <div><dt className="text-[var(--color-fg-mid)]">报名截止</dt><dd className="mt-1 font-medium">{formatDate(season.registrationClosesAt)}</dd></div>
            <div><dt className="text-[var(--color-fg-mid)]">名单调整截止</dt><dd className="mt-1 font-medium">{formatDate(season.rosterChangeClosesAt)}</dd></div>
            <div><dt className="text-[var(--color-fg-mid)]">赛事结束时间</dt><dd className="mt-1 font-medium">{formatDate(season.endAt)}</dd></div>
          </dl>
        </Panel>

        <Panel label="下一步">
          <p className="font-medium text-[var(--color-fg)]">{nextAction.label}</p>
          <p className="mt-2 text-sm leading-6 text-[var(--color-fg-mid)]">{nextAction.detail}</p>
          <Button className="mt-4" size="sm" asChild>
            <Link href={nextAction.href as never}>进入下一步 →</Link>
          </Button>
        </Panel>
      </div>

      {readiness && (
        <Panel label="当前赛前 readiness">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill label={readiness.canStart ? "已就绪" : "需处理"} tone={readiness.canStart ? "success" : "warn"} />
            <span className="text-sm text-[var(--color-fg-mid)]">
              {readiness.canStart ? "当前赛前 readiness 已通过。" : `${readiness.blockers.length} 项 blocker 仍待处理。`}
            </span>
          </div>
          {!readiness.canStart && readiness.blockers.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm text-[var(--color-fg-mid)]">
              {readiness.blockers.slice(0, 3).map((blocker) => <li key={blocker}>· {blocker}</li>)}
            </ul>
          )}
          <Link href={`/admin/${season.slug}/prestart` as never} className="mt-3 inline-block text-sm text-[var(--color-accent)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]">
            查看完整赛前检查 →
          </Link>
        </Panel>
      )}

      <AdminExceptionSummary seasonSlug={season.slug} data={{
        competitionTemplate: season.competitionTemplate,
        registrationMode: season.registrationMode,
        pendingApplications: summary.pendingApplications,
        unresolvedPrestartIssues: summary.unresolvedPrestartIssues,
        unconfirmedEntrants: summary.entrantCount - summary.frozenEntrantCount,
        scheduledMatchesWithoutConfirmedLineups: summary.scheduledMatchesWithoutConfirmedLineups,
        finalResultPendingConfirmation: summary.finalResultPendingConfirmation,
        activeAdjudications: summary.activeAdjudications,
      }} />
    </div>
  );
}
