"use client";
import React from "react";

import { useState } from "react";
import { MetricFamilyTabs } from "@/components/stats/MetricFamilyTabs";
import { MetricPanel, MetricValue } from "@/components/stats/MetricValue";
import { StatsDataTable, type StatsDataColumn } from "@/components/stats/StatsDataTable";
import type { TournamentMapDetail } from "@/lib/stats/tournament-query";
import { displayWeaponName, formatEconomyLabel } from "@/lib/stats/presentation";
import { CS2_MAP_CATALOG } from "@/lib/config/cs2-maps";

type MapTab = "overview" | "teams" | "players" | "economy" | "weapons";
const tabs = [
  { key: "overview", label: "Overview" },
  { key: "teams", label: "Teams" },
  { key: "players", label: "Players" },
  { key: "economy", label: "Economy" },
  { key: "weapons", label: "Weapons" },
] as const;

type TeamRow = TournamentMapDetail["analytics"]["teams"][number];
type WeaponRow = TournamentMapDetail["performance"]["weapons"][number];
type EconomyRow = TournamentMapDetail["analytics"]["economyMatrix"][number];

function mapLabel(mapName: string) { return CS2_MAP_CATALOG.find((map) => map.key === mapName)?.label ?? mapName; }

export function MapWorkspace({ detail }: { detail: TournamentMapDetail }) {
  const [tab, setTab] = useState<MapTab>("overview");
  const mapName = mapLabel(detail.map);
  const mapAnalytics = detail.analytics.maps.find((row) => row.mapName === detail.map);
  const performanceMap = detail.performance.maps.find((row) => row.mapName === detail.map);
  const bp = detail.selection[0];
  const performanceByTeam = new Map(detail.performance.teams.map((row) => [row.team.entityKey, row]));
  const teamNames = new Map(detail.entries.map((row) => [row.id, row.name]));
  const playersWithTeam = detail.performance.players.map((row) => ({
    ...row,
    teamName: row.teamEntityKeys.map((key) => teamNames.get(key)).filter((name): name is string => Boolean(name)).join(" / ") || "—",
  }));
  const bpColumns: StatsDataColumn<NonNullable<typeof bp>["teams"][number]>[] = [
    { key: "team", label: "Team", render: (row) => row.name },
    { key: "pick", label: "Pick", numeric: true, sortable: true, sortValue: (row) => row.picks, render: (row) => row.picks },
    { key: "ban", label: "Ban", numeric: true, sortable: true, sortValue: (row) => row.bans, render: (row) => row.bans },
  ];
  const teamColumns: StatsDataColumn<TeamRow>[] = [
    { key: "team", label: "Team", render: (row) => row.team.displayName },
    { key: "maps", label: "Maps", numeric: true, render: (row) => row.mapCount },
    { key: "rounds", label: "Rounds", numeric: true, render: (row) => row.rounds },
    { key: "rw", label: "RW%", numeric: true, sortable: true, sortValue: (row) => row.roundWinRate, render: (row) => <MetricValue metric="roundWin" value={{ wins: row.roundWins, opportunities: row.rounds, rate: row.roundWinRate }} /> },
    { key: "t", label: "T%", numeric: true, className: "hidden sm:table-cell", render: (row) => <MetricValue metric="roundWin" value={row.t} /> },
    { key: "ct", label: "CT%", numeric: true, className: "hidden sm:table-cell", render: (row) => <MetricValue metric="roundWin" value={row.ct} /> },
    { key: "pistol", label: "Pistol%", numeric: true, className: "hidden lg:table-cell", render: (row) => <MetricValue metric="pistol" value={row.pistol} /> },
    { key: "opening", label: "Opening%", numeric: true, className: "hidden lg:table-cell", render: (row) => { const value = performanceByTeam.get(row.team.entityKey)?.slices.overall.opening.successRate; return value ? <MetricValue metric="openingWin" value={value} /> : "—"; } },
  ];
  const playerColumns: StatsDataColumn<typeof playersWithTeam[number]>[] = [
    { key: "player", label: "Player", render: (row) => row.player.displayName },
    { key: "team", label: "Team", className: "hidden lg:table-cell", render: (row) => row.teamName },
    { key: "rounds", label: "Rounds", numeric: true, sortable: true, sortValue: (row) => row.slices.overall.sample.rounds, render: (row) => row.slices.overall.sample.rounds },
    { key: "kpr", label: "K/R", numeric: true, sortable: true, sortValue: (row) => row.slices.overall.combat.killsPerRound.rate, render: (row) => <MetricValue metric="kpr" value={row.slices.overall.combat.killsPerRound} /> },
    { key: "damage", label: "ADR", numeric: true, className: "hidden sm:table-cell", render: (row) => <MetricValue metric="damagePerRound" value={row.slices.overall.combat.damagePerRound} /> },
    { key: "kast", label: "KAST", numeric: true, className: "hidden sm:table-cell", render: (row) => <MetricValue metric="kast" value={row.slices.overall.kast} /> },
    { key: "opening", label: "Open Win%", numeric: true, sortable: true, sortValue: (row) => row.slices.overall.opening.successRate.rate, render: (row) => <MetricValue metric="openingWin" value={row.slices.overall.opening.successRate} /> },
    { key: "trade", label: "Trade/R", numeric: true, className: "hidden lg:table-cell", render: (row) => <MetricValue metric="trade" value={row.slices.overall.trade.tradeKillsPerRound} /> },
  ];
  const economyColumns: StatsDataColumn<EconomyRow>[] = [
    { key: "economy", label: "Economy", render: (row) => `${formatEconomyLabel(row.lowEconomy)} / ${formatEconomyLabel(row.highEconomy)}` },
    { key: "rounds", label: "Rounds", numeric: true, sortable: true, sortValue: (row) => row.rounds, render: (row) => row.rounds },
    { key: "win", label: "Lower economy win%", numeric: true, render: (row) => <MetricValue metric="ecoSemi" value={{ wins: row.lowEconomyWins, opportunities: row.rounds, rate: row.lowWinRate }} /> },
  ];
  const weaponColumns: StatsDataColumn<WeaponRow>[] = [
    { key: "weapon", label: "Weapon", render: (row) => displayWeaponName(row.weapon) },
    { key: "kills", label: "Kills", numeric: true, sortable: true, sortValue: (row) => row.kills, render: (row) => row.kills },
    { key: "share", label: "Kill share", numeric: true, sortable: true, sortValue: (row) => row.killShare.rate, render: (row) => <MetricValue metric="killShare" value={row.killShare} /> },
    { key: "perRound", label: "Kills/R", numeric: true, sortable: true, sortValue: (row) => row.killsPerRound.rate, render: (row) => <MetricValue metric="killsPerRound" value={row.killsPerRound} /> },
    { key: "hs", label: "HS%", numeric: true, sortable: true, sortValue: (row) => row.headshotRate.rate, render: (row) => <MetricValue metric="headshot" value={row.headshotRate} /> },
    { key: "top", label: "Top player", className: "hidden sm:table-cell", render: (row) => row.topPlayer?.displayName ?? "—" },
  ];

  return (
    <section className="space-y-5">
      <header><h2 className="text-xl font-semibold">{mapName}</h2><p className="mt-1 text-sm text-[var(--color-fg-mid)]">Selected map · Results {detail.results.maps.find((row) => row.mapName === detail.map)?.played ?? 0} played · DAK {detail.coverage.detailedMaps}/{detail.coverage.completedMaps} detailed.</p></header>
      <MetricFamilyTabs label="Map workspace" value={tab} options={tabs} onChange={setTab} />

      {tab === "overview" && <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <MetricPanel title="Played"><p className="text-xl font-semibold tabular-nums">{detail.results.maps.find((row) => row.mapName === detail.map)?.played ?? 0}</p></MetricPanel>
          <MetricPanel title="Detailed maps"><p className="text-xl font-semibold tabular-nums">{detail.coverage.detailedMaps}/{detail.coverage.completedMaps}</p></MetricPanel>
          <MetricPanel title="Detailed rounds"><p className="text-xl font-semibold tabular-nums">{mapAnalytics?.roundCount ?? 0}</p></MetricPanel>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <MetricPanel title="BP"><dl className="grid grid-cols-3 gap-3"><div><dt className="text-xs text-[var(--color-fg-mid)]">Pick</dt><dd>{bp?.picks ?? 0}</dd></div><div><dt className="text-xs text-[var(--color-fg-mid)]">Ban</dt><dd>{bp?.bans ?? 0}</dd></div><div><dt className="text-xs text-[var(--color-fg-mid)]">Decider</dt><dd>{bp?.deciders ?? 0}</dd></div></dl><h3 className="mb-2 mt-4 text-sm font-medium">Team | Pick | Ban</h3><StatsDataTable rows={bp?.teams ?? []} columns={bpColumns} rowKey={(row) => row.entryId} emptyLabel="暂无队伍 BP 记录" /></MetricPanel>
          <MetricPanel title="Round Profile">
            {mapAnalytics ? <dl className="grid grid-cols-2 gap-3"><div><dt>CT / T</dt><dd className="flex flex-wrap gap-2"><MetricValue metric="roundWin" value={mapAnalytics.ct} sampleLabel="CT rounds" /><MetricValue metric="roundWin" value={mapAnalytics.t} sampleLabel="T rounds" /></dd></div><div><dt>Pistol CT / T</dt><dd className="flex flex-wrap gap-2"><MetricValue metric="pistol" value={mapAnalytics.pistolCt} sampleLabel="CT pistol rounds" /><MetricValue metric="pistol" value={mapAnalytics.pistolT} sampleLabel="T pistol rounds" /></dd></div><div><dt>Opening conversion</dt><dd>{performanceMap ? <MetricValue metric="conversion" value={performanceMap.opening.conversionRate} /> : "—"}</dd></div><div><dt>Opening comeback</dt><dd>{performanceMap ? <MetricValue metric="break" value={performanceMap.opening.comebackRate} /> : "—"}</dd></div></dl> : <p className="text-sm text-[var(--color-fg-mid)]">该地图暂无已确认的 DAK 回合样本。</p>}
          </MetricPanel>
        </div>
      </div>}

      {tab === "teams" && <StatsDataTable rows={detail.analytics.teams} columns={teamColumns} rowKey={(row) => row.team.entityKey} initialSortKey="rw" emptyLabel="该地图暂无 DAK 队伍样本" />}
      {tab === "players" && <StatsDataTable rows={playersWithTeam} columns={playerColumns} rowKey={(row) => row.player.entityKey} initialSortKey="opening" emptyLabel="该地图暂无 DAK 选手样本" />}
      {tab === "economy" && <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"><MetricPanel title="Pistol"><MetricValue metric="pistol" value={detail.analytics.totals.pistolT} /></MetricPanel><MetricPanel title="R2 Conversion"><MetricValue metric="conversion" value={detail.analytics.totals.round2Conversion} /></MetricPanel><MetricPanel title="R2 Break"><MetricValue metric="break" value={detail.analytics.totals.round2Break} /></MetricPanel><MetricPanel title="5v4"><MetricValue metric="fiveVFour" value={detail.analytics.totals.manAdvantage["5v4"]} /></MetricPanel><MetricPanel title="4v5"><MetricValue metric="fourVFive" value={detail.analytics.totals.manAdvantage["4v5"]} /></MetricPanel><MetricPanel title="Eco/Semi"><MetricValue metric="ecoSemi" value={detail.analytics.totals.ecoSemiUpset} /></MetricPanel></div>
        <MetricPanel title="Economy matrix"><StatsDataTable rows={detail.analytics.economyMatrix} columns={economyColumns} rowKey={(row) => `${row.lowEconomy}:${row.highEconomy}`} emptyLabel="暂无经济分类样本" /></MetricPanel>
      </div>}
      {tab === "weapons" && <MetricPanel title={`Weapons · DAK ${detail.coverage.detailedMaps} maps / ${detail.analytics.totals.roundCount} rounds`}><StatsDataTable rows={detail.performance.weapons} columns={weaponColumns} rowKey={(row) => row.weapon} initialSortKey="kills" emptyLabel="暂无武器数据" /></MetricPanel>}
    </section>
  );
}
