import { formatCST } from "@/lib/utils/date";
import { PageHeader, PageLayout, Panel } from "@/components/rivalhub";
import type { PlatformOperationsGrowthDay, PlatformOperationsOverview as PlatformOperationsOverviewData } from "@/lib/admin/platform-operations/types";

function metricValue(value: number | null): string {
  if (value === null) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function HeadlineMetric({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <Panel contentClassName="p-4">
      <p className="font-mono text-3xl font-bold leading-none tracking-tight text-[var(--color-fg)] tabular-nums">{value}</p>
      <p className="mt-2 text-sm font-medium text-[var(--color-fg)]">{label}</p>
      {sub && <p className="mt-1 text-xs leading-5 text-[var(--color-fg-mid)]">{sub}</p>}
    </Panel>
  );
}

function PoolMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-[var(--color-border)] p-3">
      <p className="text-2xl font-semibold tabular-nums text-[var(--color-fg)]">{value}</p>
      <p className="mt-1 text-xs leading-5 text-[var(--color-fg-mid)]">{label}</p>
    </div>
  );
}

function GrowthDay({ day }: { day: PlatformOperationsGrowthDay }) {
  return (
    <li className="min-w-0 border border-[var(--color-border)] p-3">
      <p className="font-mono text-xs font-semibold text-[var(--color-fg)]">{day.label}</p>
      <dl className="mt-3 space-y-2 text-xs">
        <div className="flex items-center justify-between gap-2"><dt className="text-[var(--color-fg-mid)]">新增用户</dt><dd className="font-semibold tabular-nums">{day.newActiveUsers}</dd></div>
        <div className="flex items-center justify-between gap-2"><dt className="text-[var(--color-fg-mid)]">认证通过</dt><dd className="font-semibold tabular-nums">{day.newEducationApprovals}</dd></div>
        <div className="flex items-center justify-between gap-2"><dt className="text-[var(--color-fg-mid)]">新增队伍</dt><dd className="font-semibold tabular-nums">{day.newActiveTeams}</dd></div>
        <div className="flex items-center justify-between gap-2"><dt className="text-[var(--color-fg-mid)]">新增成员关系</dt><dd className="font-semibold tabular-nums">{day.newActiveMemberships}</dd></div>
      </dl>
    </li>
  );
}

export function PlatformOperationsOverview({ data }: { data: PlatformOperationsOverviewData }) {
  const { population, playerPool, teams, growth } = data;
  const maxBucketCount = Math.max(1, ...teams.sizeDistribution.map((bucket) => bucket.count));

  return (
    <PageLayout variant="wide" className="space-y-6">
      <PageHeader
        title="运营概览"
        description={`平台长期人口、队伍与组队供给的聚合快照。数据截至 ${formatCST(data.asOf)}。`}
      />

      <section aria-labelledby="platform-population-heading" className="space-y-3">
        <h2 id="platform-population-heading" className="text-lg font-semibold text-[var(--color-fg)]">平台人口</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <HeadlineMetric label="有效用户" value={population.activeUsers} sub="当前有效账号" />
          <HeadlineMetric label="7 日活跃用户" value={population.activeUsers7d} sub={`24h ${population.activeUsers24h} · 30d ${population.activeUsers30d}`} />
          <HeadlineMetric label="已教育认证用户" value={population.certifiedUsers} sub="当前有效用户中的 distinct 用户" />
          <HeadlineMetric label="活跃队伍" value={population.activeTeams} sub="当前仍在存续的队伍" />
        </div>
      </section>

      <Panel label="玩家池结构" contentClassName="p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <PoolMetric label="当前在队伍" value={playerPool.currentTeamUsers} />
          <PoolMetric label="认证且当前无队伍" value={playerPool.certifiedWithoutTeam} />
          <PoolMetric label="当前在队但未认证" value={playerPool.teamWithoutCertification} />
          <PoolMetric label="公开 Player LFT" value={playerPool.publicPlayerLft} />
          <PoolMetric label="公开 Team Recruiting" value={playerPool.publicTeamRecruiting} />
        </div>
        <p className="mt-4 text-xs leading-5 text-[var(--color-fg-mid)]">以上是平台当前供给结构，不代表任何一届赛事的报名资格或参赛队伍数量。</p>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <Panel label="队伍成员人数分布" contentClassName="p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <p className="text-sm text-[var(--color-fg-mid)]">当前 {teams.activeTeamCount} 支队伍 · {teams.totalMemberCount} 名当前成员</p>
            <p className="text-sm text-[var(--color-fg-mid)]">中位队伍人数 <span className="font-semibold tabular-nums text-[var(--color-fg)]">{metricValue(teams.medianTeamSize)}</span></p>
          </div>
          <ul className="mt-5 space-y-2" aria-label="队伍成员人数分布">
            {teams.sizeDistribution.map((bucket) => (
              <li key={bucket.key} className="grid grid-cols-[4.5rem_minmax(0,1fr)_2rem] items-center gap-3 text-xs">
                <span className="text-[var(--color-fg-mid)]">{bucket.label}</span>
                <div className="h-2 min-w-0 bg-[var(--color-panel-low)]" aria-hidden="true">
                  <div className="h-full bg-[var(--color-accent)]" style={{ width: `${(bucket.count / maxBucketCount) * 100}%` }} />
                </div>
                <span className="text-right font-semibold tabular-nums text-[var(--color-fg)]">{bucket.count}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs leading-5 text-[var(--color-fg-mid)]">只统计当前仍在存续的队伍与未结束的成员关系；成员人数分布不绑定某一届赛事的名单规模。</p>
        </Panel>

        <Panel label="组队大厅" contentClassName="p-5">
          <div className="space-y-3 text-sm leading-6 text-[var(--color-fg-mid)]">
            <p><span className="font-semibold text-[var(--color-fg)]">{playerPool.publicPlayerLft}</span> 条公开 Player LFT，代表当前正在找队的玩家供给。</p>
            <p><span className="font-semibold text-[var(--color-fg)]">{playerPool.publicTeamRecruiting}</span> 条公开 Team Recruiting，代表当前正在招募的队伍供给。</p>
            <p className="text-xs">统计沿用组队大厅现有的开放、未过期、账号与队伍仍有效、以及目标赛事可用性口径。</p>
          </div>
        </Panel>
      </div>

      <Panel label="平台增长 · 最近 7 天" contentClassName="p-5">
        <p className="text-xs leading-5 text-[var(--color-fg-mid)]">每天按 Asia/Shanghai（CST）自然日边界聚合；当天数据为截至当前时间的部分日。</p>
        <ol className="mt-4 grid list-none gap-2 p-0 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          {growth.map((day) => <GrowthDay key={day.date} day={day} />)}
        </ol>
      </Panel>
    </PageLayout>
  );
}
