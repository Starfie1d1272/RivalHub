"use client";

import { useState, type ReactNode } from "react";
import { MetricFamilyTabs } from "@/components/stats/MetricFamilyTabs";
import { MetricValue } from "@/components/stats/MetricValue";
import { StatsMetricLabel } from "@/components/stats/StatsMetricHelp";
import { StatsDataTable, type StatsDataColumn } from "@/components/stats/StatsDataTable";
import type { LongTeamCareerDetail, TournamentStats, TournamentTeamDetail } from "@/lib/stats/tournament-query";
import type { StatsMetricKey } from "@/lib/stats/metrics";
import { formatEconomyLabel } from "@/lib/stats/presentation";

type TeamPerformanceDetail = LongTeamCareerDetail | TournamentTeamDetail;
type TeamTab = "overview" | "rounds" | "teamplay" | "maps" | "players" | "weapons";

const tabs = [
  { key: "overview", label: "Overview" },
  { key: "rounds", label: "Rounds & Economy" },
  { key: "teamplay", label: "Teamplay" },
  { key: "maps", label: "Maps" },
  { key: "players", label: "Players" },
  { key: "weapons", label: "Weapons" },
] as const;

type MetricItem = {
  label: string;
  value: ReactNode;
  metric?: StatsMetricKey;
};

function MetricSection({
  title,
  items,
  columns = 4,
}: {
  title: string;
  items: MetricItem[];
  columns?: 3 | 4 | 5 | 6;
}) {
  const gridClass = columns === 3
    ? "sm:grid-cols-3"
    : columns === 5
      ? "sm:grid-cols-5"
      : columns === 6
        ? "sm:grid-cols-3 lg:grid-cols-6"
        : "sm:grid-cols-4";

  return (
    <section className="border-t border-[var(--color-border)] pt-4">
      <h3 className="mb-4 text-sm font-semibold text-[var(--color-fg)]">{title}</h3>
      <dl className={["grid grid-cols-2 gap-x-5 gap-y-5", gridClass].join(" ")}>
        {items.map((item) => (
          <div key={item.label} className="min-w-0">
            <dt className="text-xs leading-5 text-[var(--color-fg-mid)]">
              {item.metric ? <StatsMetricLabel metric={item.metric}>{item.label}</StatsMetricLabel> : item.label}
            </dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums text-[var(--color-fg)]">{item.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function normalizedResults(detail: TeamPerformanceDetail) {
  if ("linkedEntries" in detail) {
    return {
      matches: detail.results.played,
      matchWins: detail.results.wins,
      matchLosses: detail.results.losses,
      maps: detail.results.maps,
      mapWins: detail.results.mapWins,
      mapLosses: detail.results.mapLosses,
    };
  }
  return detail.results ? {
    matches: detail.results.matches,
    matchWins: detail.results.matchWins,
    matchLosses: detail.results.matchLosses,
    maps: detail.results.maps,
    mapWins: detail.results.mapWins,
    mapLosses: detail.results.mapLosses,
  } : null;
}

export function TeamWorkspace({
  detail,
}: {
  detail: TeamPerformanceDetail;
  seasonSlug?: string;
}) {
  const [tab, setTab] = useState<TeamTab>("overview");
  const result = normalizedResults(detail);
  const analytics = detail.analytics;
  const performance = detail.performance;

  const economyColumns: StatsDataColumn<TournamentStats["analytics"]["economyMatrix"][number]>[] = [
    { key: "combo", label: "Economy", render: (row) => `${formatEconomyLabel(row.lowEconomy)} / ${formatEconomyLabel(row.highEconomy)}` },
    { key: "rounds", label: "Rounds", numeric: true, sortable: true, sortValue: (row) => row.rounds, render: (row) => row.rounds },
    { key: "win", label: "Eco/Semi Win%", metric: "ecoSemi", numeric: true, sortable: true, sortValue: (row) => row.lowWinRate, rankingSample: (row) => row.rounds, render: (row) => <MetricValue metric="ecoSemi" value={{ wins: row.lowEconomyWins, opportunities: row.rounds, rate: row.lowWinRate }} sampleDisplay="compact" /> },
  ];

  return (
    <section className="space-y-5">
      <MetricFamilyTabs label="Team performance" value={tab} options={tabs} onChange={setTab} />

      {tab === "overview" && (
        <div className="space-y-6">
          <MetricSection title="Results" items={[
            { label: "Match W-L", value: result ? `${result.matchWins}-${result.matchLosses}` : "—" },
            { label: "Matches", value: result?.matches ?? "—" },
            { label: "Map W-L", value: result ? `${result.mapWins}-${result.mapLosses}` : "—" },
            { label: "Maps", value: result?.maps ?? "—" },
          ]} />
          {analytics ? (
            <MetricSection title="Round Performance" items={[
              { label: "Rounds", value: analytics.rounds },
              { label: "RW%", metric: "roundWin", value: <MetricValue metric="roundWin" value={{ wins: analytics.roundWins, opportunities: analytics.rounds, rate: analytics.roundWinRate }} sampleDisplay="hidden" /> },
              { label: "CT%", metric: "roundWin", value: <MetricValue metric="roundWin" value={analytics.ct} sampleDisplay="hidden" /> },
              { label: "T%", metric: "roundWin", value: <MetricValue metric="roundWin" value={analytics.t} sampleDisplay="hidden" /> },
              { label: "Pistol", metric: "pistol", value: <MetricValue metric="pistol" value={analytics.pistol} sampleDisplay="hidden" /> },
            ]} columns={5} />
          ) : (
            <p className="border-y border-[var(--color-border)] py-5 text-sm text-[var(--color-fg-mid)]">当前队伍没有详细回合数据。</p>
          )}
        </div>
      )}

      {tab === "rounds" && (
        <div className="space-y-6">
          {analytics ? (
            <>
              <MetricSection title="Round Conversion" items={[
                { label: "Pistol", metric: "pistol", value: <MetricValue metric="pistol" value={analytics.pistol} /> },
                { label: "R2 Conversion", metric: "conversion", value: <MetricValue metric="conversion" value={analytics.round2.conversion} /> },
                { label: "R2 Break", metric: "break", value: <MetricValue metric="break" value={analytics.round2.break} /> },
              ]} columns={3} />
              <MetricSection title="Man Advantage" items={[
                { label: "5v4", metric: "fiveVFour", value: <MetricValue metric="fiveVFour" value={analytics.manAdvantage["5v4"]} /> },
                { label: "4v5", metric: "fourVFive", value: <MetricValue metric="fourVFive" value={analytics.manAdvantage["4v5"]} /> },
                { label: "Eco/Semi Win%", metric: "ecoSemi", value: <MetricValue metric="ecoSemi" value={analytics.ecoSemiUpset} /> },
              ]} columns={3} />
            </>
          ) : (
            <p className="border-y border-[var(--color-border)] py-5 text-sm text-[var(--color-fg-mid)]">当前队伍没有详细回合数据。</p>
          )}
          <section className="border-t border-[var(--color-border)] pt-4">
            <h3 className="mb-1 text-sm font-semibold">Economy Matchups</h3>
            <p className="mb-4 text-xs text-[var(--color-fg-mid)]">按实际回合经济组合聚合；空样本不按 0 处理。</p>
            <StatsDataTable
              embedded
              rows={detail.economyMatrix}
              columns={economyColumns}
              rowKey={(row) => `${row.lowEconomy}:${row.highEconomy}`}
              emptyLabel="暂无经济分类样本"
            />
          </section>
        </div>
      )}

      {tab === "teamplay" && (
        performance ? (
          <div className="space-y-6">
            <MetricSection title="Opening" items={[
              { label: "Opening win%", metric: "openingWin", value: <MetricValue metric="openingWin" value={performance.slices.overall.opening.successRate} /> },
              { label: "Opening attempt%", metric: "openingAttempt", value: <MetricValue metric="openingAttempt" value={performance.slices.overall.opening.attemptRate} /> },
            ]} columns={3} />
            <MetricSection title="Trading" items={[
              { label: "Trade/100r", metric: "trade", value: <MetricValue metric="trade" value={performance.slices.overall.trade.tradeKillsPerRound} /> },
              { label: "Traded%", metric: "traded", value: <MetricValue metric="traded" value={performance.slices.overall.trade.tradedDeathsPerDeath} /> },
            ]} columns={3} />
            <MetricSection title="Utility" items={[
              { label: "FA/100r", metric: "flashAssist", value: <MetricValue metric="flashAssist" value={performance.slices.overall.utility.flashAssistsPerRound} /> },
              { label: "Util/r", metric: "utility", value: <MetricValue metric="utility" value={performance.slices.overall.utility.utilityDamagePerRound} /> },
              { label: "Blind/Flash", metric: "blindPerFlash", value: <MetricValue metric="blindPerFlash" value={performance.slices.overall.utility.enemyBlindSecondsPerFlash} /> },
            ]} columns={3} />
            <MetricSection title="Objective" items={[
              { label: "Plant conversion", metric: "plantConversion", value: <MetricValue metric="plantConversion" value={performance.slices.overall.objective.plantConversions} /> },
            ]} columns={3} />
          </div>
        ) : (
          <p className="border-y border-[var(--color-border)] py-5 text-sm text-[var(--color-fg-mid)]">当前队伍没有详细团队数据。</p>
        )
      )}

      {(tab === "maps" || tab === "players" || tab === "weapons") && (
        <p className="border-y border-[var(--color-border)] py-5 text-sm text-[var(--color-fg-mid)]">
          {tab === "maps" ? "地图表现将在下一阶段接入这里。" : tab === "players" ? "选手表现将在下一阶段接入这里。" : "武器数据将在下一阶段接入这里。"}
        </p>
      )}
    </section>
  );
}
