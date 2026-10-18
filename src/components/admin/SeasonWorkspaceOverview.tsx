import { MAJOR_PRESTART_PHASES } from "@/lib/admin/season-workspace/prestart-phase";
import React from "react";
import Link from "next/link";
import { PageHeader, Panel, Stat, StatusPill } from "@/components/rivalhub";
import { AdminExceptionSummary } from "@/components/admin/AdminExceptionSummary";
import { Button } from "@/components/ui/button";
import { presentSeasonStatus } from "@/lib/seasons/presentation";
import { formatCST } from "@/lib/utils/date";
import type { SeasonWorkspaceOverviewData } from "@/lib/admin/season-workspace/types";

function formatDate(value: Date | null): string {
  if (!value) return "未配置";
  return formatCST(value);
}

export function SeasonWorkspaceOverview({ data }: { data: SeasonWorkspaceOverviewData }) {
  const { season, summary, nextAction } = data;
  const preparing = !["playing", "finished", "archived"].includes(season.status);
  const root = `/admin/${season.slug}`;
  const status = presentSeasonStatus(season.status);
  const isTeamRegistration = season.registrationMode === "team";
  const stats = isTeamRegistration
    ? [
      { label: "已冻结正赛名单", value: summary.entrantCount ? `${summary.frozenEntrantCount} / ${summary.entrantCount} 队` : "尚未确定" },
      { label: "比赛", value: summary.matchCount },
    ]
    : [
      { label: "待审核报名", value: summary.pendingApplications },
      { label: "已批准报名", value: summary.approvedEntries },
      { label: "已形成队伍", value: summary.formedTeamCount },
      { label: "比赛", value: summary.matchCount },
    ];
  const registrationWindowLabel = data.registrationFunnel
    ? ({ hidden: "报名已截止", closed: "报名已截止", open: "报名进行中", upcoming: "报名尚未开放", unscheduled: "报名时间待定" } as const)[data.registrationFunnel.windowPhase]
    : null;

  return (
    <div className="space-y-5">
      <PageHeader title={season.name} description={preparing ? "筹备本届赛事，随时进入工作台处理具体事务。" : "跟进当前赛事，继续比赛执行与整届收尾。"} actions={<StatusPill {...status} />} />

      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <Panel label={preparing ? "办赛进度" : "赛事进展"}>
          {preparing && data.prestartPhase ? <>
            <p className="text-lg font-semibold">{MAJOR_PRESTART_PHASES[data.prestartPhase - 1]}</p>
            <ol aria-label="Major 开赛筹备进度" className="my-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {MAJOR_PRESTART_PHASES.map((label, index) => <li key={label}
                aria-current={index + 1 === data.prestartPhase ? "step" : undefined}
                className={`border-t-2 pt-2 text-sm ${index + 1 === data.prestartPhase ? "border-[var(--color-accent)] font-semibold text-[var(--color-accent)]" : "border-[var(--color-border)] text-[var(--color-fg-mid)]"}`}>
                <span className="mr-2 font-mono">{index + 1}</span>{label}
              </li>)}
            </ol>
          </> : <p className="text-lg font-semibold">{status.label}</p>}
          <p className="mt-2 text-sm leading-6 text-[var(--color-fg-mid)]">{nextAction.detail}</p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button size="sm" asChild><Link href={nextAction.href as never}>{nextAction.label} →</Link></Button>
            {preparing && nextAction.href !== `${root}/prestart` && <Link href={`${root}/prestart` as never} className="text-sm text-[var(--color-accent)]">继续开赛筹备 →</Link>}
            {!preparing && <Link href={`${root}/prestart` as never} className="text-sm text-[var(--color-fg-mid)]">查看筹备记录</Link>}
          </div>
        </Panel>
        <Panel label="工作台入口">
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              { label: "比赛执行", detail: "我的认领、排期与单场处理", href: `${root}/matches` },
              { label: "赛程与阶段", detail: "编排赛程、积分与阶段推进", href: `${root}/matches?view=schedule` },
              { label: "参赛管理", detail: `${summary.pendingApplications} 份报名待审核`, href: `${root}/registrations` },
              { label: "本届公告", detail: "通知发布与内容维护", href: `${root}/announcements` },
            ].map(item => <Link key={item.label} href={item.href as never} className="border border-[var(--color-border)] p-3 transition-colors hover:bg-[var(--color-panel-hi)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]">
              <span className="block text-sm font-medium">{item.label} →</span>
              <span className="mt-1 block text-xs text-[var(--color-fg-mid)]">{item.detail}</span>
            </Link>)}
          </div>
        </Panel>
      </div>

      <Panel label="赛事概览">
        <div className={`grid gap-4 sm:grid-cols-2 ${isTeamRegistration ? "lg:grid-cols-2" : "lg:grid-cols-4"}`}>
          {stats.map((stat) => (
            <div key={stat.label} className="border border-[var(--color-border)] px-3 py-3">
              <p className="text-xs text-[var(--color-fg-mid)]">{stat.label}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-[var(--color-fg)]">{stat.value}</p>
            </div>
          ))}
        </div>
      </Panel>

      {data.registrationFunnel && (
        <Panel label="队伍报名概览">
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
            <Stat label="报名总数" value={data.registrationFunnel.total} accent={data.registrationFunnel.total > 0} />
            <Stat label="草稿" value={data.registrationFunnel.draft} />
            <Stat label="待审核" value={data.registrationFunnel.submitted} />
            <Stat label="已批准" value={data.registrationFunnel.approved} />
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] pt-3 text-sm">
            <div className="text-[var(--color-fg-mid)]">
              <span>报名窗口 · {registrationWindowLabel}</span>
              <span className="mx-2 text-[var(--color-fg-dim)]">·</span>
              <span>报名截止 · {formatDate(data.registrationFunnel.deadline)}</span>
            </div>
            <Button size="sm" variant="outline" asChild>
              <Link href={`/admin/${season.slug}/registrations`}>进入报名审核 →</Link>
            </Button>
          </div>
          {data.registrationFunnel.total === 0 && (
            <p className="mt-3 text-sm text-[var(--color-fg-dim)]">当前暂无队伍报名记录。</p>
          )}
        </Panel>
      )}

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
