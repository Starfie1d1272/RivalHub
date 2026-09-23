"use client";
import React from "react";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MetricFamilyTabs } from "@/components/stats/MetricFamilyTabs";
import { MetricValue } from "@/components/stats/MetricValue";
import { StatsDataTable, type StatsDataColumn } from "@/components/stats/StatsDataTable";
import type { TournamentStats } from "@/lib/stats/tournament-query";
import { statsHref, type StatsQuery } from "@/lib/stats/view-state";
import { navigateStatsScope } from "@/lib/stats/view-state";
import { CS2_MAP_CATALOG } from "@/lib/config/cs2-maps";

type Family = "overall" | "opening" | "teamplay" | "utility" | "clutch";
const families = [
  { key: "overall", label: "Overall" },
  { key: "opening", label: "Opening" },
  { key: "teamplay", label: "Teamplay" },
  { key: "utility", label: "Utility" },
  { key: "clutch", label: "Clutch" },
] as const;

type ScoreboardRow = TournamentStats["leaderboard"][number];
type DAKPlayer = TournamentStats["performance"]["players"][number];

function playerTeam(row: ScoreboardRow | DAKPlayer, teamNames: ReadonlyMap<string, string>) {
  if ("perfectName" in row) return row.teamName ?? "—";
  const names = row.teamEntityKeys.map((id) => teamNames.get(id)).filter((name): name is string => Boolean(name));
  return names.join(" / ") || "—";
}

function playerHref(seasonSlug: string, query: StatsQuery, id: string | null) {
  return id ? statsHref(seasonSlug, query, { player: id }) : undefined;
}

function DAKColumns(family: Exclude<Family, "overall">, teamNames: ReadonlyMap<string, string>, seasonSlug: string, query: StatsQuery): StatsDataColumn<DAKPlayer>[] {
  const identity: StatsDataColumn<DAKPlayer>[] = [
    { key: "player", label: "Player", render: (row) => <Link href={playerHref(seasonSlug, query, row.player.entityKey)!} scroll={false} className="font-medium hover:text-[var(--color-accent)]">{row.player.displayName}</Link> },
    { key: "team", label: "Team", className: "hidden sm:table-cell", render: (row) => playerTeam(row, teamNames) },
    { key: "maps", label: "Maps", numeric: true, className: "hidden sm:table-cell", sortable: true, sortValue: (row) => row.mapCount, render: (row) => row.mapCount },
    { key: "rounds", label: "Rounds", numeric: true, sortable: true, sortValue: (row) => row.slices.overall.sample.rounds, render: (row) => row.slices.overall.sample.rounds },
  ];
  const columns: Record<Exclude<Family, "overall">, StatsDataColumn<DAKPlayer>[]> = {
    opening: [
      { key: "attempt", label: "Open Att%", numeric: true, sortable: true, sortValue: (row) => row.slices.overall.opening.attemptRate.rate, render: (row) => <MetricValue metric="openingAttempt" value={row.slices.overall.opening.attemptRate} /> },
      { key: "win", label: "Open Win%", numeric: true, sortable: true, sortValue: (row) => row.slices.overall.opening.successRate.rate, render: (row) => <MetricValue metric="openingWin" value={row.slices.overall.opening.successRate} /> },
      { key: "fk", label: "FK/R", numeric: true, className: "hidden lg:table-cell", sortable: true, sortValue: (row) => row.slices.overall.opening.firstKillsPerRound.rate, render: (row) => <MetricValue metric="firstKill" value={row.slices.overall.opening.firstKillsPerRound} /> },
      { key: "fd", label: "FD/R", numeric: true, className: "hidden lg:table-cell", sortable: true, sortValue: (row) => row.slices.overall.opening.firstDeathsPerRound.rate, render: (row) => <MetricValue metric="firstDeath" value={row.slices.overall.opening.firstDeathsPerRound} /> },
    ],
    teamplay: [
      { key: "kast", label: "KAST", numeric: true, sortable: true, sortValue: (row) => row.slices.overall.kast.rate, render: (row) => <MetricValue metric="kast" value={row.slices.overall.kast} /> },
      { key: "survival", label: "Survival%", numeric: true, sortable: true, sortValue: (row) => row.slices.overall.survival.rate, render: (row) => <MetricValue metric="survival" value={row.slices.overall.survival} /> },
      { key: "trade", label: "Trade/R", numeric: true, className: "hidden lg:table-cell", sortable: true, sortValue: (row) => row.slices.overall.trade.tradeKillsPerRound.rate, render: (row) => <MetricValue metric="trade" value={row.slices.overall.trade.tradeKillsPerRound} /> },
      { key: "traded", label: "Traded%", numeric: true, className: "hidden lg:table-cell", sortable: true, sortValue: (row) => row.slices.overall.trade.tradedDeathsPerDeath.rate, render: (row) => <MetricValue metric="traded" value={row.slices.overall.trade.tradedDeathsPerDeath} /> },
    ],
    utility: [
      { key: "util", label: "Util/R", numeric: true, sortable: true, sortValue: (row) => row.slices.overall.utility.utilityDamagePerRound.rate, render: (row) => <MetricValue metric="utility" value={row.slices.overall.utility.utilityDamagePerRound} /> },
      { key: "fa", label: "FA/R", numeric: true, sortable: true, sortValue: (row) => row.slices.overall.utility.flashAssistsPerRound.rate, render: (row) => <MetricValue metric="flashAssist" value={row.slices.overall.utility.flashAssistsPerRound} /> },
      { key: "blind", label: "Blind/Flash", numeric: true, className: "hidden lg:table-cell", sortable: true, sortValue: (row) => row.slices.overall.utility.enemyBlindSecondsPerFlash.rate, render: (row) => <MetricValue metric="blindPerFlash" value={row.slices.overall.utility.enemyBlindSecondsPerFlash} /> },
      { key: "he", label: "HE/R", numeric: true, className: "hidden lg:table-cell", sortable: true, sortValue: (row) => row.slices.overall.utility.heDamagePerRound.rate, render: (row) => <MetricValue metric="hePerRound" value={row.slices.overall.utility.heDamagePerRound} /> },
    ],
    clutch: [
      { key: "attempts", label: "Attempts", numeric: true, sortable: true, sortValue: (row) => row.slices.overall.clutch.attempts, render: (row) => row.slices.overall.clutch.attempts },
      { key: "clutch", label: "Clutch%", numeric: true, sortable: true, sortValue: (row) => row.slices.overall.clutch.winRate.rate, render: (row) => <MetricValue metric="clutch" value={row.slices.overall.clutch.winRate} /> },
      { key: "1v1", label: "1v1%", numeric: true, className: "hidden lg:table-cell", sortable: true, sortValue: (row) => row.slices.overall.clutch.byOpponentCount["1"].rate, render: (row) => <MetricValue metric="clutch" value={row.slices.overall.clutch.byOpponentCount["1"]} sampleLabel="1v1 attempts" /> },
      { key: "1v2", label: "1v2%", numeric: true, className: "hidden lg:table-cell", sortable: true, sortValue: (row) => row.slices.overall.clutch.byOpponentCount["2"].rate, render: (row) => <MetricValue metric="clutch" value={row.slices.overall.clutch.byOpponentCount["2"]} sampleLabel="1v2 attempts" /> },
    ],
  };
  return [...identity, ...columns[family]];
}

export function PlayersExplorer({ data, query, seasonSlug }: { data: TournamentStats; query: StatsQuery; seasonSlug: string }) {
  const router = useRouter();
  const [family, setFamily] = useState<Family>("overall");
  const [search, setSearch] = useState("");
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const teamNames = useMemo(() => new Map(data.options.teams.map((team) => [team.id, team.name])), [data.options.teams]);
  const scoreboardRows = useMemo(() => data.leaderboard.filter((row) => `${row.perfectName} ${row.teamName ?? ""}`.toLocaleLowerCase().includes(normalizedSearch)), [data.leaderboard, normalizedSearch]);
  const dakRows = useMemo(() => data.performance.players.filter((row) => `${row.player.displayName} ${playerTeam(row, teamNames)}`.toLocaleLowerCase().includes(normalizedSearch)), [data.performance.players, normalizedSearch, teamNames]);
  const overallColumns: StatsDataColumn<ScoreboardRow>[] = [
    { key: "player", label: "Player", render: (row) => { const href = playerHref(seasonSlug, query, row.userId); return href ? <Link href={href} scroll={false} className="font-medium hover:text-[var(--color-accent)]">{row.perfectName}</Link> : row.perfectName; } },
    { key: "team", label: "Team", className: "hidden sm:table-cell", render: (row) => row.teamName ?? "—" },
    { key: "maps", label: "Maps", numeric: true, sortable: true, sortValue: (row) => row.maps, render: (row) => row.maps },
    { key: "rounds", label: "Rounds", numeric: true, className: "hidden sm:table-cell", sortable: true, sortValue: (row) => row.rounds, render: (row) => row.rounds ?? "—" },
    { key: "rating", label: "Rating", numeric: true, sortable: true, sortValue: (row) => row.avgRating, render: (row) => <MetricValue metric="rating" value={row.avgRating} /> },
    { key: "adr", label: "ADR", numeric: true, sortable: true, sortValue: (row) => row.avgAdr, render: (row) => <MetricValue metric="adr" value={row.avgAdr} /> },
    { key: "kd", label: "K/D", numeric: true, className: "hidden lg:table-cell", sortable: true, sortValue: (row) => row.kdRatio, render: (row) => <MetricValue metric="kd" value={row.kdRatio} /> },
    { key: "kpr", label: "KPR", numeric: true, className: "hidden lg:table-cell", sortable: true, sortValue: (row) => row.kpr, render: (row) => <MetricValue metric="kpr" value={row.kpr} /> },
  ];
  const table = family === "overall"
    ? <StatsDataTable key={`${family}:${search}`} rows={scoreboardRows} columns={overallColumns} rowKey={(row, index) => `${row.userId ?? row.perfectName}:${row.teamId ?? ""}:${index}`} initialSortKey="rating" emptyLabel="暂无选手统计" />
    : <StatsDataTable key={`${family}:${search}`} rows={dakRows} columns={DAKColumns(family, teamNames, seasonSlug, query)} rowKey={(row, index) => `${row.player.entityKey}:dak:${index}`} initialSortKey={family === "opening" ? "win" : family === "teamplay" ? "kast" : family === "utility" ? "util" : "clutch"} emptyLabel="该范围暂无详细统计" />;
  return (
    <section className="space-y-4">
      <div className="flex min-w-0 flex-wrap items-end gap-3 rounded-sm border border-[var(--color-border)] bg-[var(--color-panel)] p-3">
        <label className="grid gap-1 text-sm">地图
          <select value={query.mapFilter} onChange={(event) => navigateStatsScope(router, seasonSlug, query, { mapFilter: event.target.value })} className="min-h-10 min-w-36 rounded-sm border border-[var(--color-border)] bg-[var(--color-panel)] px-3">
            <option value="">全部地图</option>{data.options.maps.map((map) => <option key={map} value={map}>{CS2_MAP_CATALOG.find((row) => row.key === map)?.label ?? map}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm">队伍
          <select value={query.teamFilter} onChange={(event) => navigateStatsScope(router, seasonSlug, query, { teamFilter: event.target.value })} className="min-h-10 min-w-36 rounded-sm border border-[var(--color-border)] bg-[var(--color-panel)] px-3">
            <option value="">全部队伍</option>{data.options.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
          </select>
        </label>
        <label className="grid min-w-48 flex-1 gap-1 text-sm">搜索选手
          <input value={search} onChange={(event) => setSearch(event.target.value)} type="search" className="min-h-10 rounded-sm border border-[var(--color-border)] bg-[var(--color-panel)] px-3" placeholder="姓名或队伍" />
        </label>
      </div>
      <MetricFamilyTabs label="Player metric family" value={family} options={families} onChange={setFamily} />
      {family !== "overall" && data.coverage.completedMaps > 0 && data.coverage.detailedMaps < data.coverage.completedMaps && <p className="text-xs text-[var(--color-fg-mid)]">Coverage {data.coverage.detailedMaps}/{data.coverage.completedMaps} maps</p>}
      {table}
    </section>
  );
}
