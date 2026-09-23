"use client";
import React from "react";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PlayerProfileLink } from "@/components/players/PlayerProfileLink";
import { MetricFamilyTabs } from "@/components/stats/MetricFamilyTabs";
import { MetricValue } from "@/components/stats/MetricValue";
import { StatsDataTable, type StatsDataColumn } from "@/components/stats/StatsDataTable";
import type { TournamentStats } from "@/lib/stats/tournament-query";
import type { StatsQuery } from "@/lib/stats/view-state";
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

function playerLink(id: string | null, name: string) {
  return id
    ? <PlayerProfileLink userId={id} className="font-medium">{name}</PlayerProfileLink>
    : name;
}

function DAKColumns(family: Exclude<Family, "overall">, teamNames: ReadonlyMap<string, string>): StatsDataColumn<DAKPlayer>[] {
  const identity: StatsDataColumn<DAKPlayer>[] = [
    { key: "player", label: "Player", className: "w-[24%]", render: (row) => playerLink(row.player.entityKey, row.player.displayName) },
    { key: "team", label: "Team", className: "hidden w-[20%] sm:table-cell", render: (row) => playerTeam(row, teamNames) },
    { key: "maps", label: "Maps", numeric: true, className: "hidden w-[8%] sm:table-cell", sortable: true, sortValue: (row) => row.mapCount, render: (row) => row.mapCount },
    { key: "rounds", label: "Rounds", numeric: true, className: "w-[9%]", sortable: true, sortValue: (row) => row.slices.overall.sample.rounds, render: (row) => row.slices.overall.sample.rounds },
  ];

  const columns: Record<Exclude<Family, "overall">, StatsDataColumn<DAKPlayer>[]> = {
    opening: [
      { key: "attempt", label: "Open Att%", numeric: true, sortable: true, sortValue: (row) => row.slices.overall.opening.attemptRate.rate, render: (row) => <MetricValue metric="openingAttempt" value={row.slices.overall.opening.attemptRate} sampleDisplay="hidden" /> },
      { key: "win", label: "Open Win%", numeric: true, sortable: true, sortValue: (row) => row.slices.overall.opening.successRate.rate, render: (row) => <MetricValue metric="openingWin" value={row.slices.overall.opening.successRate} sampleDisplay="compact" /> },
      { key: "fk", label: "FK/R", numeric: true, className: "hidden lg:table-cell", sortable: true, sortValue: (row) => row.slices.overall.opening.firstKillsPerRound.rate, render: (row) => <MetricValue metric="firstKill" value={row.slices.overall.opening.firstKillsPerRound} sampleDisplay="hidden" /> },
      { key: "fd", label: "FD/R", numeric: true, className: "hidden lg:table-cell", sortable: true, sortValue: (row) => row.slices.overall.opening.firstDeathsPerRound.rate, render: (row) => <MetricValue metric="firstDeath" value={row.slices.overall.opening.firstDeathsPerRound} sampleDisplay="hidden" /> },
    ],
    teamplay: [
      { key: "kast", label: "KAST", numeric: true, sortable: true, sortValue: (row) => row.slices.overall.kast.rate, render: (row) => <MetricValue metric="kast" value={row.slices.overall.kast} sampleDisplay="hidden" /> },
      { key: "survival", label: "Survival%", numeric: true, sortable: true, sortValue: (row) => row.slices.overall.survival.rate, render: (row) => <MetricValue metric="survival" value={row.slices.overall.survival} sampleDisplay="hidden" /> },
      { key: "trade", label: "Trade/R", numeric: true, className: "hidden lg:table-cell", sortable: true, sortValue: (row) => row.slices.overall.trade.tradeKillsPerRound.rate, render: (row) => <MetricValue metric="trade" value={row.slices.overall.trade.tradeKillsPerRound} sampleDisplay="hidden" /> },
      { key: "traded", label: "Traded%", numeric: true, className: "hidden lg:table-cell", sortable: true, sortValue: (row) => row.slices.overall.trade.tradedDeathsPerDeath.rate, render: (row) => <MetricValue metric="traded" value={row.slices.overall.trade.tradedDeathsPerDeath} sampleDisplay="compact" /> },
    ],
    utility: [
      { key: "util", label: "Util/R", numeric: true, sortable: true, sortValue: (row) => row.slices.overall.utility.utilityDamagePerRound.rate, render: (row) => <MetricValue metric="utility" value={row.slices.overall.utility.utilityDamagePerRound} sampleDisplay="hidden" /> },
      { key: "fa", label: "FA/R", numeric: true, sortable: true, sortValue: (row) => row.slices.overall.utility.flashAssistsPerRound.rate, render: (row) => <MetricValue metric="flashAssist" value={row.slices.overall.utility.flashAssistsPerRound} sampleDisplay="hidden" /> },
      { key: "blind", label: "Blind/Flash", numeric: true, className: "hidden lg:table-cell", sortable: true, sortValue: (row) => row.slices.overall.utility.enemyBlindSecondsPerFlash.rate, render: (row) => <MetricValue metric="blindPerFlash" value={row.slices.overall.utility.enemyBlindSecondsPerFlash} /> },
      { key: "he", label: "HE/R", numeric: true, className: "hidden lg:table-cell", sortable: true, sortValue: (row) => row.slices.overall.utility.heDamagePerRound.rate, render: (row) => <MetricValue metric="hePerRound" value={row.slices.overall.utility.heDamagePerRound} sampleDisplay="hidden" /> },
    ],
    clutch: [
      { key: "attempts", label: "Attempts", numeric: true, sortable: true, sortValue: (row) => row.slices.overall.clutch.attempts, render: (row) => row.slices.overall.clutch.attempts },
      { key: "clutch", label: "Clutch%", numeric: true, sortable: true, sortValue: (row) => row.slices.overall.clutch.winRate.rate, render: (row) => <MetricValue metric="clutch" value={row.slices.overall.clutch.winRate} sampleDisplay="compact" /> },
      { key: "1v1", label: "1v1%", numeric: true, className: "hidden lg:table-cell", sortable: true, sortValue: (row) => row.slices.overall.clutch.byOpponentCount["1"].rate, render: (row) => <MetricValue metric="clutch" value={row.slices.overall.clutch.byOpponentCount["1"]} sampleDisplay="compact" /> },
      { key: "1v2", label: "1v2%", numeric: true, className: "hidden lg:table-cell", sortable: true, sortValue: (row) => row.slices.overall.clutch.byOpponentCount["2"].rate, render: (row) => <MetricValue metric="clutch" value={row.slices.overall.clutch.byOpponentCount["2"]} sampleDisplay="compact" /> },
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
  const scoreboardRows = useMemo(
    () => data.leaderboard.filter((row) => `${row.perfectName} ${row.teamName ?? ""}`.toLocaleLowerCase().includes(normalizedSearch)),
    [data.leaderboard, normalizedSearch],
  );
  const dakRows = useMemo(
    () => data.performance.players.filter((row) => `${row.player.displayName} ${playerTeam(row, teamNames)}`.toLocaleLowerCase().includes(normalizedSearch)),
    [data.performance.players, normalizedSearch, teamNames],
  );

  const overallColumns: StatsDataColumn<ScoreboardRow>[] = [
    { key: "player", label: "Player", className: "w-[24%]", render: (row) => playerLink(row.userId, row.perfectName) },
    { key: "team", label: "Team", className: "hidden w-[20%] sm:table-cell", render: (row) => row.teamName ?? "—" },
    { key: "maps", label: "Maps", numeric: true, className: "w-[8%]", sortable: true, sortValue: (row) => row.maps, render: (row) => row.maps },
    { key: "rounds", label: "Rounds", numeric: true, className: "hidden w-[9%] sm:table-cell", sortable: true, sortValue: (row) => row.rounds, render: (row) => row.rounds ?? "—" },
    { key: "rating", label: "Rating", numeric: true, sortable: true, sortValue: (row) => row.avgRating, render: (row) => <MetricValue metric="rating" value={row.avgRating} /> },
    { key: "adr", label: "ADR", numeric: true, sortable: true, sortValue: (row) => row.avgAdr, render: (row) => <MetricValue metric="adr" value={row.avgAdr} /> },
    { key: "kd", label: "K/D", numeric: true, className: "hidden lg:table-cell", sortable: true, sortValue: (row) => row.kdRatio, render: (row) => <MetricValue metric="kd" value={row.kdRatio} /> },
    { key: "kpr", label: "KPR", numeric: true, className: "hidden lg:table-cell", sortable: true, sortValue: (row) => row.kpr, render: (row) => <MetricValue metric="kpr" value={row.kpr} /> },
  ];

  const visibleRows = family === "overall" ? scoreboardRows : dakRows;
  const table = family === "overall"
    ? <StatsDataTable key={`${family}:${search}`} rows={scoreboardRows} columns={overallColumns} rowKey={(row, index) => `${row.userId ?? row.perfectName}:${row.teamId ?? ""}:${index}`} initialSortKey="rating" tableClassName="min-w-[900px] table-fixed" emptyLabel="暂无选手统计" />
    : <StatsDataTable key={`${family}:${search}`} rows={dakRows} columns={DAKColumns(family, teamNames)} rowKey={(row, index) => `${row.player.entityKey}:detail:${index}`} initialSortKey={family === "opening" ? "win" : family === "teamplay" ? "kast" : family === "utility" ? "util" : "clutch"} tableClassName="min-w-[960px] table-fixed" emptyLabel="该范围暂无详细统计" />;

  const partialCoverage = family !== "overall" && data.coverage.completedMaps > 0 && data.coverage.detailedMaps < data.coverage.completedMaps;

  return (
    <section className="space-y-4">
      <MetricFamilyTabs label="Player metrics" value={family} options={families} onChange={setFamily} />

      <div className="flex min-w-0 flex-wrap items-end gap-3">
        <label className="grid gap-1">
          <span className="text-[11px] uppercase tracking-[var(--tracking-label)] text-[var(--color-fg-mid)]">Map</span>
          <select value={query.mapFilter} onChange={(event) => navigateStatsScope(router, seasonSlug, query, { mapFilter: event.target.value })} className="min-h-8 min-w-36 border border-[var(--color-border)] bg-[var(--color-panel-low)] px-2.5 py-1.5 text-sm">
            <option value="">All maps</option>
            {data.options.maps.map((map) => <option key={map} value={map}>{CS2_MAP_CATALOG.find((row) => row.key === map)?.label ?? map}</option>)}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-[11px] uppercase tracking-[var(--tracking-label)] text-[var(--color-fg-mid)]">Team</span>
          <select value={query.teamFilter} onChange={(event) => navigateStatsScope(router, seasonSlug, query, { teamFilter: event.target.value })} className="min-h-8 min-w-40 border border-[var(--color-border)] bg-[var(--color-panel-low)] px-2.5 py-1.5 text-sm">
            <option value="">All teams</option>
            {data.options.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
          </select>
        </label>
        <label className="grid min-w-56 flex-1 gap-1 sm:max-w-sm">
          <span className="text-[11px] uppercase tracking-[var(--tracking-label)] text-[var(--color-fg-mid)]">Search</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} type="search" className="min-h-8 border border-[var(--color-border)] bg-[var(--color-panel-low)] px-2.5 py-1.5 text-sm" placeholder="Player or team" />
        </label>
        <div className="ml-auto flex items-center gap-3 pb-1 text-xs text-[var(--color-fg-dim)]">
          {partialCoverage && <span>Coverage {data.coverage.detailedMaps}/{data.coverage.completedMaps}</span>}
          <span>{visibleRows.length} players</span>
        </div>
      </div>

      {table}
    </section>
  );
}
