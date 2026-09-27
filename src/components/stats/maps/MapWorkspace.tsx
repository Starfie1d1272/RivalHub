"use client";
import React from "react";

import { useState } from "react";
import Link from "next/link";
import { PlayerProfileLink } from "@/components/players/PlayerProfileLink";
import { MetricFamilyTabs } from "@/components/stats/MetricFamilyTabs";
import { MetricPanel, MetricValue } from "@/components/stats/MetricValue";
import { StatsMetricLabel } from "@/components/stats/StatsMetricHelp";
import { StatsDataTable, type StatsDataColumn } from "@/components/stats/StatsDataTable";
import type { TournamentMapDetail } from "@/lib/stats/tournament-query";
import { formatEconomyLabel, statsRateDenominator } from "@/lib/stats/presentation";
import { CS2_MAP_CATALOG } from "@/lib/config/cs2-maps";

type MapTab = "overview" | "teams" | "players" | "economy";
const tabs = [
  { key: "overview", label: "Overview" },
  { key: "teams", label: "Teams" },
  { key: "players", label: "Players" },
  { key: "economy", label: "Economy" },
] as const;

type TeamRow = TournamentMapDetail["analytics"]["teams"][number];
type EconomyRow = TournamentMapDetail["analytics"]["economyMatrix"][number];

function mapLabel(mapName: string) { return CS2_MAP_CATALOG.find((map) => map.key === mapName)?.label ?? mapName; }

export function MapWorkspace({ detail, seasonSlug }: { detail: TournamentMapDetail; seasonSlug: string }) {
  const [tab, setTab] = useState<MapTab>("overview");
  const mapName = mapLabel(detail.map);
  const mapAnalytics = detail.analytics.maps.find((row) => row.mapName === detail.map);
  const performanceMap = detail.performance.maps.find((row) => row.mapName === detail.map);
  const bp = detail.selection[0];
  const partialCoverage = detail.coverage.completedMaps > 0 && detail.coverage.detailedMaps < detail.coverage.completedMaps;
  const performanceByTeam = new Map(detail.performance.teams.map((row) => [row.team.entityKey, row]));
  const teamNames = new Map(detail.entries.map((row) => [row.id, row.name]));
  const playersWithTeam = detail.performance.players.map((row) => ({
    ...row,
    teamEntries: row.teamEntityKeys.map((key) => ({ id: key, name: teamNames.get(key) ?? key })),
  }));
  const teamColumns: StatsDataColumn<TeamRow>[] = [
    { key: "team", label: "Team", render: (row) => <Link href={`/${seasonSlug}/teams/${row.team.entityKey}`} className="font-medium hover:text-[var(--color-accent)]">{row.team.displayName}</Link> },
    { key: "maps", label: "Maps", numeric: true, sortable: true, sortValue: (row) => row.mapCount, render: (row) => row.mapCount },
    { key: "rounds", label: "Rounds", numeric: true, sortable: true, sortValue: (row) => row.rounds, render: (row) => row.rounds },
    { key: "rw", label: "RW%", metric: "roundWin", numeric: true, sortable: true, sortValue: (row) => row.roundWinRate, rankingSample: (row) => row.rounds, render: (row) => <MetricValue metric="roundWin" value={{ wins: row.roundWins, opportunities: row.rounds, rate: row.roundWinRate }} sampleDisplay="hidden" /> },
    { key: "ct", label: "CT%", metric: "roundWin", numeric: true, className: "hidden sm:table-cell", sortable: true, sortValue: (row) => row.ct.rate, rankingSample: (row) => statsRateDenominator(row.ct), render: (row) => <MetricValue metric="roundWin" value={row.ct} sampleDisplay="hidden" /> },
    { key: "t", label: "T%", metric: "roundWin", numeric: true, className: "hidden sm:table-cell", sortable: true, sortValue: (row) => row.t.rate, rankingSample: (row) => statsRateDenominator(row.t), render: (row) => <MetricValue metric="roundWin" value={row.t} sampleDisplay="hidden" /> },
    { key: "pistol", label: "Pistol Win%", metric: "pistol", numeric: true, className: "hidden lg:table-cell", sortable: true, sortValue: (row) => row.pistol.rate, rankingSample: (row) => statsRateDenominator(row.pistol), render: (row) => <MetricValue metric="pistol" value={row.pistol} sampleDisplay="compact" /> },
    { key: "opening", label: "Opening Success%", metric: "openingWin", numeric: true, className: "hidden lg:table-cell", sortable: true, sortValue: (row) => performanceByTeam.get(row.team.entityKey)?.slices.overall.opening.successRate.rate, rankingSample: (row) => { const value = performanceByTeam.get(row.team.entityKey)?.slices.overall.opening.successRate; return value ? statsRateDenominator(value) : null; }, render: (row) => { const value = performanceByTeam.get(row.team.entityKey)?.slices.overall.opening.successRate; return value ? <MetricValue metric="openingWin" value={value} sampleDisplay="compact" /> : "—"; } },
  ];
  const playerColumns: StatsDataColumn<typeof playersWithTeam[number]>[] = [
    { key: "player", label: "Player", render: (row) => <PlayerProfileLink userId={row.player.entityKey} className="font-medium">{row.player.displayName}</PlayerProfileLink> },
    { key: "team", label: "Team", className: "hidden lg:table-cell", render: (row) => row.teamEntries.length ? <span>{row.teamEntries.map((team, index) => <React.Fragment key={team.id}>{index > 0 ? " / " : null}<Link href={`/${seasonSlug}/teams/${team.id}`} className="hover:text-[var(--color-accent)]">{team.name}</Link></React.Fragment>)}</span> : "—" },
    { key: "rounds", label: "Rounds", numeric: true, sortable: true, sortValue: (row) => row.slices.overall.sample.rounds, render: (row) => row.slices.overall.sample.rounds },
    { key: "kpr", label: "KPR", metric: "kpr", numeric: true, sortable: true, sortValue: (row) => row.slices.overall.combat.killsPerRound.rate, rankingSample: (row) => row.slices.overall.sample.rounds, render: (row) => <MetricValue metric="kpr" value={row.slices.overall.combat.killsPerRound} sampleDisplay="hidden" /> },
    { key: "damage", label: "ADR", metric: "damagePerRound", numeric: true, className: "hidden sm:table-cell", sortable: true, sortValue: (row) => row.slices.overall.combat.damagePerRound.rate, rankingSample: (row) => row.slices.overall.sample.rounds, render: (row) => <MetricValue metric="damagePerRound" value={row.slices.overall.combat.damagePerRound} sampleDisplay="hidden" /> },
    { key: "kast", label: "KAST", metric: "kast", numeric: true, className: "hidden sm:table-cell", sortable: true, sortValue: (row) => row.slices.overall.kast.rate, rankingSample: (row) => row.slices.overall.sample.rounds, render: (row) => <MetricValue metric="kast" value={row.slices.overall.kast} sampleDisplay="hidden" /> },
    { key: "opening", label: "Opening Success%", metric: "openingWin", numeric: true, sortable: true, sortValue: (row) => row.slices.overall.opening.successRate.rate, rankingSample: (row) => statsRateDenominator(row.slices.overall.opening.successRate), render: (row) => <MetricValue metric="openingWin" value={row.slices.overall.opening.successRate} sampleDisplay="compact" /> },
    { key: "trade", label: "Trade/100r", metric: "trade", numeric: true, className: "hidden lg:table-cell", sortable: true, sortValue: (row) => row.slices.overall.trade.tradeKillsPerRound.rate, rankingSample: (row) => row.slices.overall.sample.rounds, render: (row) => <MetricValue metric="trade" value={row.slices.overall.trade.tradeKillsPerRound} sampleDisplay="hidden" /> },
  ];
  const economyColumns: StatsDataColumn<EconomyRow>[] = [
    { key: "economy", label: "Economy", render: (row) => `${formatEconomyLabel(row.lowEconomy)} / ${formatEconomyLabel(row.highEconomy)}` },
    { key: "rounds", label: "Rounds", numeric: true, sortable: true, sortValue: (row) => row.rounds, render: (row) => row.rounds },
    { key: "win", label: "Eco/Semi Win%", metric: "ecoSemi", numeric: true, sortable: true, sortValue: (row) => row.lowWinRate, rankingSample: (row) => row.rounds, render: (row) => <MetricValue metric="ecoSemi" value={{ wins: row.lowEconomyWins, opportunities: row.rounds, rate: row.lowWinRate }} sampleDisplay="compact" /> },
  ];

  return (
    <section className="space-y-5">
      <header><h2 className="text-xl font-semibold">{mapName}</h2><p className="mt-1 text-sm text-[var(--color-fg-mid)]">{detail.results.maps.find((row) => row.mapName === detail.map)?.played ?? 0} maps · {mapAnalytics?.roundCount ?? 0} rounds{partialCoverage ? ` · Coverage ${detail.coverage.detailedMaps}/${detail.coverage.completedMaps}` : ""}</p></header>
      <MetricFamilyTabs label="Map workspace" value={tab} options={tabs} onChange={setTab} />

      {tab === "overview" && <div className="grid gap-4 lg:grid-cols-2">
        <MetricPanel title="Map Selection">
          <dl className="grid grid-cols-3 gap-3">
            <div><dt className="text-xs text-[var(--color-fg-mid)]">Picks</dt><dd className="font-semibold tabular-nums">{bp?.picks ?? 0}</dd></div>
            <div><dt className="text-xs text-[var(--color-fg-mid)]">Bans</dt><dd className="font-semibold tabular-nums">{bp?.bans ?? 0}</dd></div>
            <div><dt className="text-xs text-[var(--color-fg-mid)]">Deciders</dt><dd className="font-semibold tabular-nums">{bp?.deciders ?? 0}</dd></div>
          </dl>
        </MetricPanel>
        <MetricPanel title="Round Profile">
          {mapAnalytics ? <dl className="grid grid-cols-2 gap-3"><div><dt><StatsMetricLabel metric="roundWin">CT / T</StatsMetricLabel></dt><dd className="flex flex-wrap gap-2"><MetricValue metric="roundWin" value={mapAnalytics.ct} sampleLabel="CT rounds" /><MetricValue metric="roundWin" value={mapAnalytics.t} sampleLabel="T rounds" /></dd></div><div><dt><StatsMetricLabel metric="pistol">Pistol CT / T</StatsMetricLabel></dt><dd className="flex flex-wrap gap-2"><MetricValue metric="pistol" value={mapAnalytics.pistolCt} sampleLabel="CT pistol rounds" /><MetricValue metric="pistol" value={mapAnalytics.pistolT} sampleLabel="T pistol rounds" /></dd></div><div><dt><StatsMetricLabel metric="conversion">Opening conversion</StatsMetricLabel></dt><dd>{performanceMap ? <MetricValue metric="conversion" value={performanceMap.opening.conversionRate} /> : "—"}</dd></div><div><dt><StatsMetricLabel metric="break">Opening comeback</StatsMetricLabel></dt><dd>{performanceMap ? <MetricValue metric="break" value={performanceMap.opening.comebackRate} /> : "—"}</dd></div></dl> : <p className="text-sm text-[var(--color-fg-mid)]">该地图暂无详细回合数据。</p>}
        </MetricPanel>
      </div>}

      {tab === "teams" && <StatsDataTable rows={detail.analytics.teams} rankingBaselineRows={detail.analytics.teams} columns={teamColumns} rowKey={(row) => row.team.entityKey} initialSortKey="rw" emptyLabel="该地图暂无队伍统计" />}
      {tab === "players" && <StatsDataTable rows={playersWithTeam} rankingBaselineRows={playersWithTeam} columns={playerColumns} rowKey={(row) => row.player.entityKey} initialSortKey="opening" emptyLabel="该地图暂无选手统计" />}
      {tab === "economy" && <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"><MetricPanel title={<StatsMetricLabel metric="pistol">Pistol CT / T</StatsMetricLabel>}><div className="flex flex-wrap gap-3 text-sm"><span>CT <MetricValue metric="pistol" value={detail.analytics.totals.pistolCt} sampleLabel="CT pistol rounds" /></span><span>T <MetricValue metric="pistol" value={detail.analytics.totals.pistolT} sampleLabel="T pistol rounds" /></span></div></MetricPanel><MetricPanel title={<StatsMetricLabel metric="conversion">R2 Conversion</StatsMetricLabel>}><MetricValue metric="conversion" value={detail.analytics.totals.round2Conversion} /></MetricPanel><MetricPanel title={<StatsMetricLabel metric="break">R2 Break</StatsMetricLabel>}><MetricValue metric="break" value={detail.analytics.totals.round2Break} /></MetricPanel><MetricPanel title={<StatsMetricLabel metric="fiveVFour">5v4</StatsMetricLabel>}><MetricValue metric="fiveVFour" value={detail.analytics.totals.manAdvantage["5v4"]} /></MetricPanel><MetricPanel title={<StatsMetricLabel metric="fourVFive">4v5</StatsMetricLabel>}><MetricValue metric="fourVFive" value={detail.analytics.totals.manAdvantage["4v5"]} /></MetricPanel><MetricPanel title={<StatsMetricLabel metric="ecoSemi">Eco/Semi Win%</StatsMetricLabel>}><MetricValue metric="ecoSemi" value={detail.analytics.totals.ecoSemiUpset} /></MetricPanel></div>
        <MetricPanel title="Economy Matchups"><StatsDataTable embedded rows={detail.analytics.economyMatrix} columns={economyColumns} rowKey={(row) => `${row.lowEconomy}:${row.highEconomy}`} emptyLabel="暂无经济分类样本" /></MetricPanel>
      </div>}
    </section>
  );
}
