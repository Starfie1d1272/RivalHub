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
  const { season, summary, nextAction } = data;
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

      <Panel label="下一步">
        <p className="font-medium text-[var(--color-fg)]">{nextAction.label}</p>
        <p className="mt-2 text-sm leading-6 text-[var(--color-fg-mid)]">{nextAction.detail}</p>
        <Button className="mt-4" size="sm" asChild>
          <Link href={nextAction.href as never}>进入下一步 →</Link>
        </Button>
      </Panel>

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
      </div>

      <AdminExceptionSummary seasonSlug={season.slug} data={{
        competitionTemplate: season.competitionTemplate,
        unconfirmedEntrants: summary.entrantCount - summary.frozenEntrantCount,
        scheduledMatchesWithoutConfirmedLineups: summary.scheduledMatchesWithoutConfirmedLineups,
        finalResultPendingConfirmation: summary.finalResultPendingConfirmation,
        activeAdjudications: summary.activeAdjudications,
      }} />
    </div>
  );
}
