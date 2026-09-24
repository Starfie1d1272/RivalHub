"use client";
import React from "react";

import { useState } from "react";
import Link from "next/link";
import { PlayerProfileLink } from "@/components/players/PlayerProfileLink";
import { MetricFamilyTabs } from "@/components/stats/MetricFamilyTabs";
import { MetricPanel, MetricValue } from "@/components/stats/MetricValue";
import { StatsMetricLabel } from "@/components/stats/StatsMetricHelp";
import { StatsDataTable, type StatsDataColumn } from "@/components/stats/StatsDataTable";
import type { TournamentStats, TournamentTeamDetail } from "@/lib/stats/tournament-query";
import { formatEconomyLabel, statsRateDenominator } from "@/lib/stats/presentation";
import { CS2_MAP_CATALOG } from "@/lib/config/cs2-maps";

type TeamTab = "overview" | "maps" | "rounds" | "teamplay" | "players";
const tabs = [
  { key: "overview", label: "Overview" },
  { key: "maps", label: "Map Pool" },
  { key: "rounds", label: "Rounds & Economy" },
  { key: "teamplay", label: "Teamplay" },
  { key: "players", label: "Players" },
] as const;

function mapLabel(mapName: string) {
  return CS2_MAP_CATALOG.find((map) => map.key === mapName)?.label ?? mapName;
}

export function TeamWorkspace({ detail, seasonSlug }: { detail: TournamentTeamDetail; seasonSlug: string }) {
  const [tab, setTab] = useState<TeamTab>("overview");
  const result = detail.results;
  const analytics = detail.analytics;
  const performance = detail.performance;
  const title = result?.name ?? detail.entries.find((entry) => entry.id === detail.teamId)?.name ?? "队伍详情";
  const mapColumns: StatsDataColumn<(typeof detail.maps)[number]>[] = [
    { key: "map", label: "Map", render: (row) => mapLabel(row.mapName) },
    { key: "played", label: "Played", numeric: true, sortable: true, sortValue: (row) => row.results?.played ?? 0, render: (row) => row.results?.played ?? 0 },
    { key: "mapRecord", label: "Map W-L", numeric: true, className: "hidden sm:table-cell", sortable: true, sortValue: (row) => row.results ? row.results.wins - row.results.losses : null, render: (row) => row.results ? `${row.results.wins}-${row.results.losses}` : "—" },
    { key: "pick", label: "Picks", numeric: true, className: "hidden sm:table-cell", sortable: true, sortValue: (row) => row.selection?.picks ?? 0, render: (row) => row.selection?.picks ?? 0 },
    { key: "ban", label: "Bans", numeric: true, className: "hidden sm:table-cell", sortable: true, sortValue: (row) => row.selection?.bans ?? 0, render: (row) => row.selection?.bans ?? 0 },
    { key: "detail", label: "Detail", numeric: true, sortable: true, sortValue: (row) => row.coverage.detailedMaps, render: (row) => `${row.coverage.detailedMaps}/${row.coverage.completedMaps}` },
    { key: "rw", label: "RW%", metric: "roundWin", numeric: true, className: "hidden lg:table-cell", sortable: true, sortValue: (row) => row.analytics?.roundWinRate, rankingSample: (row) => row.analytics?.rounds, render: (row) => row.analytics ? <MetricValue metric="roundWin" value={{ wins: row.analytics.roundWins, opportunities: row.analytics.rounds, rate: row.analytics.roundWinRate }} sampleDisplay="hidden" /> : "—" },
    { key: "tct", label: "CT% / T%", numeric: true, className: "hidden lg:table-cell", render: (row) => row.analytics ? <span className="inline-flex gap-2"><MetricValue metric="roundWin" value={row.analytics.ct} sampleLabel="CT rounds" /><MetricValue metric="roundWin" value={row.analytics.t} sampleLabel="T rounds" /></span> : "—" },
  ];
  const scoreboardColumns: StatsDataColumn<(typeof detail.scoreboard)[number]>[] = [
    { key: "player", label: "Player", render: (row) => row.userId ? <PlayerProfileLink userId={row.userId} className="font-medium">{row.perfectName}</PlayerProfileLink> : row.perfectName },
    { key: "maps", label: "Maps", numeric: true, sortable: true, sortValue: (row) => row.maps, render: (row) => row.maps },
    { key: "rounds", label: "Rounds", numeric: true, className: "hidden sm:table-cell", sortable: true, sortValue: (row) => row.rounds, render: (row) => row.rounds ?? "—" },
    { key: "rating", label: "Rating", metric: "rating", numeric: true, sortable: true, sortValue: (row) => row.avgRating, rankingSample: (row) => row.rounds, render: (row) => <MetricValue metric="rating" value={row.avgRating} /> },
    { key: "adr", label: "ADR", metric: "adr", numeric: true, className: "hidden sm:table-cell", sortable: true, sortValue: (row) => row.avgAdr, rankingSample: (row) => row.rounds, render: (row) => <MetricValue metric="adr" value={row.avgAdr} /> },
    { key: "kd", label: "K/D", metric: "kd", numeric: true, className: "hidden lg:table-cell", sortable: true, sortValue: (row) => row.kdRatio, rankingSample: (row) => row.rounds, render: (row) => <MetricValue metric="kd" value={row.kdRatio} /> },
  ];
  const detailedColumns: StatsDataColumn<(typeof detail.detailedPlayers)[number]>[] = [
    { key: "player", label: "Player", render: (row) => <PlayerProfileLink userId={row.player.entityKey} className="font-medium">{row.player.displayName}</PlayerProfileLink> },
    { key: "maps", label: "Maps", numeric: true, sortable: true, sortValue: (row) => row.mapCount, render: (row) => row.mapCount },
    { key: "rounds", label: "Rounds", numeric: true, sortable: true, sortValue: (row) => row.slices.overall.sample.rounds, render: (row) => row.slices.overall.sample.rounds },
    { key: "kast", label: "KAST", metric: "kast", numeric: true, className: "hidden sm:table-cell", sortable: true, sortValue: (row) => row.slices.overall.kast.rate, rankingSample: (row) => row.slices.overall.sample.rounds, render: (row) => <MetricValue metric="kast" value={row.slices.overall.kast} sampleDisplay="hidden" /> },
    { key: "opening", label: "Opening Success%", metric: "openingWin", numeric: true, className: "hidden sm:table-cell", sortable: true, sortValue: (row) => row.slices.overall.opening.successRate.rate, rankingSample: (row) => statsRateDenominator(row.slices.overall.opening.successRate), render: (row) => <MetricValue metric="openingWin" value={row.slices.overall.opening.successRate} sampleDisplay="compact" /> },
    { key: "trade", label: "Trade/100r", metric: "trade", numeric: true, className: "hidden lg:table-cell", sortable: true, sortValue: (row) => row.slices.overall.trade.tradeKillsPerRound.rate, rankingSample: (row) => row.slices.overall.sample.rounds, render: (row) => <MetricValue metric="trade" value={row.slices.overall.trade.tradeKillsPerRound} sampleDisplay="hidden" /> },
  ];
  const economyColumns: StatsDataColumn<TournamentStats["analytics"]["economyMatrix"][number]>[] = [
    { key: "combo", label: "Economy", render: (row) => `${formatEconomyLabel(row.lowEconomy)} / ${formatEconomyLabel(row.highEconomy)}` },
    { key: "rounds", label: "Rounds", numeric: true, sortable: true, sortValue: (row) => row.rounds, render: (row) => row.rounds },
    { key: "win", label: "Eco/Semi Win%", metric: "ecoSemi", numeric: true, sortable: true, sortValue: (row) => row.lowWinRate, rankingSample: (row) => row.rounds, render: (row) => <MetricValue metric="ecoSemi" value={{ wins: row.lowEconomyWins, opportunities: row.rounds, rate: row.lowWinRate }} sampleDisplay="compact" /> },
  ];

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-xl font-semibold">{title}</h2></div>
        <Link href={`/${seasonSlug}/teams/${detail.teamId}`} className="rounded-sm border border-[var(--color-border)] px-3 py-2 text-sm hover:text-[var(--color-accent)]">打开赛事队伍主页</Link>
      </header>
      <MetricFamilyTabs label="Team workspace" value={tab} options={tabs} onChange={setTab} />

      {tab === "overview" && <div className="grid gap-4 md:grid-cols-2">
        <MetricPanel title="Results">
          <dl className="grid grid-cols-2 gap-3"><div><dt className="text-xs text-[var(--color-fg-mid)]">Match W-L</dt><dd className="font-semibold tabular-nums">{result ? `${result.matchWins}-${result.matchLosses}` : "—"}</dd></div><div><dt className="text-xs text-[var(--color-fg-mid)]">Map W-L</dt><dd className="font-semibold tabular-nums">{result ? `${result.mapWins}-${result.mapLosses}` : "—"}</dd></div><div><dt className="text-xs text-[var(--color-fg-mid)]">Maps played</dt><dd className="font-semibold tabular-nums">{result?.maps ?? 0}</dd></div></dl>
        </MetricPanel>
        <MetricPanel title="Round Performance">
          {analytics ? <dl className="grid grid-cols-2 gap-3"><div><dt className="text-xs text-[var(--color-fg-mid)]">Rounds</dt><dd className="font-semibold tabular-nums">{analytics.rounds}</dd></div><div><dt className="text-xs text-[var(--color-fg-mid)]"><StatsMetricLabel metric="roundWin">RW%</StatsMetricLabel></dt><dd><MetricValue metric="roundWin" value={{ wins: analytics.roundWins, opportunities: analytics.rounds, rate: analytics.roundWinRate }} /></dd></div><div><dt className="text-xs text-[var(--color-fg-mid)]"><StatsMetricLabel metric="roundWin">CT%</StatsMetricLabel></dt><dd><MetricValue metric="roundWin" value={analytics.ct} /></dd></div><div><dt className="text-xs text-[var(--color-fg-mid)]"><StatsMetricLabel metric="roundWin">T%</StatsMetricLabel></dt><dd><MetricValue metric="roundWin" value={analytics.t} /></dd></div><div><dt className="text-xs text-[var(--color-fg-mid)]"><StatsMetricLabel metric="pistol">Pistol Win%</StatsMetricLabel></dt><dd><MetricValue metric="pistol" value={analytics.pistol} /></dd></div></dl> : <p className="text-sm text-[var(--color-fg-mid)]">当前队伍没有详细回合数据。</p>}
        </MetricPanel>
      </div>}

      {tab === "maps" && <div className="space-y-3"><StatsDataTable rows={detail.maps} columns={mapColumns} rowKey={(row) => row.mapName} initialSortKey="played" emptyLabel="当前队伍没有地图样本" /></div>}

      {tab === "rounds" && <div className="space-y-4">
        {analytics ? <div className="grid grid-cols-2 gap-3">
          <MetricPanel title={<StatsMetricLabel metric="pistol">Pistol Win%</StatsMetricLabel>}><MetricValue metric="pistol" value={analytics.pistol} /></MetricPanel>
          <MetricPanel title={<StatsMetricLabel metric="conversion">R2 Conversion</StatsMetricLabel>}><MetricValue metric="conversion" value={analytics.round2.conversion} /></MetricPanel>
          <MetricPanel title={<StatsMetricLabel metric="break">R2 Break</StatsMetricLabel>}><MetricValue metric="break" value={analytics.round2.break} /></MetricPanel>
          <MetricPanel title={<StatsMetricLabel metric="fiveVFour">5v4</StatsMetricLabel>}><MetricValue metric="fiveVFour" value={analytics.manAdvantage["5v4"]} /></MetricPanel>
          <MetricPanel title={<StatsMetricLabel metric="fourVFive">4v5</StatsMetricLabel>}><MetricValue metric="fourVFive" value={analytics.manAdvantage["4v5"]} /></MetricPanel>
          <MetricPanel title={<StatsMetricLabel metric="ecoSemi">Eco/Semi Win%</StatsMetricLabel>}><MetricValue metric="ecoSemi" value={analytics.ecoSemiUpset} /></MetricPanel>
        </div> : <p className="text-sm text-[var(--color-fg-mid)]">当前队伍没有详细回合数据。</p>}
        <MetricPanel title="Economy Matchups"><p className="mb-3 text-xs text-[var(--color-fg-mid)]">All rounds from maps played by this team.</p><StatsDataTable embedded rows={detail.economyMatrix} columns={economyColumns} rowKey={(row) => `${row.lowEconomy}:${row.highEconomy}`} emptyLabel="暂无经济分类样本" /></MetricPanel>
      </div>}

      {tab === "teamplay" && (performance ? <div className="grid grid-cols-2 gap-4">
        <MetricPanel title="Opening"><dl className="grid grid-cols-2 gap-3"><div><dt><StatsMetricLabel metric="openingWin">Opening win%</StatsMetricLabel></dt><dd><MetricValue metric="openingWin" value={performance.slices.overall.opening.successRate} /></dd></div><div><dt><StatsMetricLabel metric="openingAttempt">Opening attempt%</StatsMetricLabel></dt><dd><MetricValue metric="openingAttempt" value={performance.slices.overall.opening.attemptRate} /></dd></div></dl></MetricPanel>
        <MetricPanel title="Trades"><dl className="grid grid-cols-2 gap-3"><div><dt><StatsMetricLabel metric="trade">Trade/100r</StatsMetricLabel></dt><dd><MetricValue metric="trade" value={performance.slices.overall.trade.tradeKillsPerRound} /></dd></div><div><dt><StatsMetricLabel metric="traded">Traded%</StatsMetricLabel></dt><dd><MetricValue metric="traded" value={performance.slices.overall.trade.tradedDeathsPerDeath} /></dd></div></dl></MetricPanel>
        <MetricPanel title="Utility"><dl className="grid grid-cols-2 gap-3"><div><dt><StatsMetricLabel metric="flashAssist">FA/100r</StatsMetricLabel></dt><dd><MetricValue metric="flashAssist" value={performance.slices.overall.utility.flashAssistsPerRound} /></dd></div><div><dt><StatsMetricLabel metric="utility">Util/r</StatsMetricLabel></dt><dd><MetricValue metric="utility" value={performance.slices.overall.utility.utilityDamagePerRound} /></dd></div><div><dt><StatsMetricLabel metric="blindPerFlash">Blind/Flash</StatsMetricLabel></dt><dd><MetricValue metric="blindPerFlash" value={performance.slices.overall.utility.enemyBlindSecondsPerFlash} /></dd></div></dl></MetricPanel>
        <MetricPanel title={<StatsMetricLabel metric="plantConversion">Plant conversion</StatsMetricLabel>}><MetricValue metric="plantConversion" value={performance.slices.overall.objective.plantConversions} /></MetricPanel>
      </div> : <p className="text-sm text-[var(--color-fg-mid)]">当前队伍没有详细团队数据。</p>)}

      {tab === "players" && <div className="space-y-4">
        <MetricPanel title="Performance"><StatsDataTable embedded rows={detail.scoreboard} rankingBaselineRows={detail.scoreboard} columns={scoreboardColumns} rowKey={(row, index) => `${row.userId ?? row.perfectName}:${index}`} emptyLabel="暂无选手统计" /></MetricPanel>
        <MetricPanel title="Advanced"><StatsDataTable embedded rows={detail.detailedPlayers} rankingBaselineRows={detail.detailedPlayers} columns={detailedColumns} rowKey={(row) => row.player.entityKey} emptyLabel="暂无详细选手统计" /></MetricPanel>
      </div>}
    </section>
  );
}
