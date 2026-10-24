"use client";
import { ContentReady } from "@/components/telemetry/ContentReady";

import { TeamProfileLink } from "@/components/teams/TeamProfileLink";
import React from "react";

import Link from "next/link";
import { PlayerProfileLink } from "@/components/players/PlayerProfileLink";
import { Insights } from "./Insights";
import { MetricValue } from "@/components/stats/MetricValue";
import { StatsMetricLabel } from "@/components/stats/StatsMetricHelp";
import { StatsSideSplit } from "@/components/stats/StatsSideSplit";
import { StatsDataTable, type StatsDataColumn } from "@/components/stats/StatsDataTable";
import { StatsTooltip } from "@/components/stats/StatsTooltip";
import type { OverviewReadModel } from "@/lib/stats/overview";
type MapLandscapeRow = OverviewReadModel["maps"][number];
type EconomyMatrixRow = OverviewReadModel["economyRows"][number];
import { statsHref, type StatsQuery } from "@/lib/stats/view-state";
import { displayWeaponName } from "@/lib/stats/presentation";
import { STATS_METRICS } from "@/lib/stats/metrics";
import { CS2_MAP_CATALOG } from "@/lib/config/cs2-maps";

function mapLabel(mapName: string) {
  return CS2_MAP_CATALOG.find((row) => row.key === mapName)?.label ?? mapName;
}

function economyBuyLabel(value: EconomyMatrixRow["lowEconomy"]): string {
  if (value === "eco") return "Eco";
  if (value === "semi") return "Semi";
  if (value === "force") return "Force";
  return value;
}

function formatPercent(rate: number | null): string {
  return rate === null ? "—" : `${(rate * 100).toFixed(1)}%`;
}

function leaders(data: OverviewReadModel, query: StatsQuery, seasonSlug: string) {
  const { topPlayers, topTeams, topWeapons } = data;
  const playerColumns: StatsDataColumn<OverviewReadModel["topPlayers"][number]>[] = [
    { key: "player", label: "Player", className: "w-[40%]", render: (row) => row.userId ? <PlayerProfileLink userId={row.userId} className="font-medium">{row.perfectName}</PlayerProfileLink> : row.perfectName },
    { key: "rating", label: "Rating", metric: "rating", numeric: true, className: "w-[22%]", render: (row) => <MetricValue metric="rating" value={row.avgRating} /> },
    { key: "sample", label: "Maps / Rds", numeric: true, className: "hidden w-[26%] sm:table-cell", render: (row) => <span>{row.maps} / {row.rounds ?? "—"}</span> },
  ];
  const teamColumns: StatsDataColumn<OverviewReadModel["topTeams"][number]>[] = [
    { key: "team", label: "Team", className: "w-[34%]", render: (row) => <span className="block truncate" title={row.name}><TeamProfileLink profileHref={data.teamLinks?.[row.entryId] ?? `/${seasonSlug}/teams/${row.entryId}`} className="font-medium hover:text-[var(--color-accent)]">{row.name}</TeamProfileLink></span> },
    { key: "rating", metric: "rating", numeric: true, className: "w-[21%]", render: (row) => <MetricValue metric="rating" value={row.rating} /> },
    { key: "match", label: "W-L", numeric: true, className: "w-[18%]", render: (row) => `${row.matchWins}-${row.matchLosses}` },
    { key: "maps", label: "Maps", numeric: true, className: "hidden w-[15%] sm:table-cell", render: (row) => row.maps },
  ];
  const weaponColumns: StatsDataColumn<OverviewReadModel["topWeapons"][number]>[] = [
    { key: "weapon", label: "Weapon", className: "w-[46%]", render: (row) => <span className="font-medium">{displayWeaponName(row.weapon)}</span> },
    { key: "kills", label: "Kills", numeric: true, className: "w-[18%]", render: (row) => row.kills },
    { key: "share", label: "Share", metric: "killShare", numeric: true, className: "w-[24%]", render: (row) => <MetricValue metric="killShare" value={row.killShare} sampleDisplay="hidden" /> },
  ];
  return { topPlayers, topTeams, topWeapons, playerColumns, teamColumns, weaponColumns };
}

export function OverviewStats({ data, query, seasonSlug }: { data: OverviewReadModel; query: StatsQuery; seasonSlug: string }) {
  const maps = data.maps;
  const { topPlayers, topTeams, topWeapons, playerColumns, teamColumns, weaponColumns } = leaders(data, query, seasonSlug);
  const partialCoverage = data.coverage.completedMaps > 0 && data.coverage.detailedMaps < data.coverage.completedMaps;
  const mapColumns: StatsDataColumn<MapLandscapeRow>[] = [
    { key: "map", label: "Map", className: "w-[24%]", render: (row) => <Link href={statsHref(seasonSlug, query, { tab: "maps", map: row.mapName })} scroll={false} className="font-medium hover:text-[var(--color-accent)]">{mapLabel(row.mapName)}</Link> },
    { key: "played", label: "Played", numeric: true, className: "w-[12%]", sortable: true, sortValue: (row) => row.played, render: (row) => row.played },
    { key: "rounds", label: "Rounds", numeric: true, className: "w-[14%]", sortable: true, sortValue: (row) => row.rounds, render: (row) => row.rounds },
    { key: "side", label: "CT / T", className: "hidden w-[34%] sm:table-cell", sortable: true, sortValue: (row) => row.ct?.rate, render: (row) => <StatsSideSplit ct={row.ct} t={row.t} compact /> },
  ];
  if (partialCoverage) mapColumns.push({ key: "coverage", label: "Coverage", numeric: true, className: "hidden w-[16%] sm:table-cell", render: (row) => `${row.detailed}/${row.completed}` });

  const economyRows = data.economyRows;
  const overallEconomy = data.overallEconomy;
  const highlights = data.highlights;
  const economyColumns: StatsDataColumn<EconomyMatrixRow>[] = [
    { key: "buy", label: "Buy", className: "w-[34%]", render: (row) => <span className="font-medium">{economyBuyLabel(row.lowEconomy)}</span> },
    { key: "rounds", label: "Rounds", numeric: true, className: "w-[24%]", sortable: true, sortValue: (row) => row.rounds, render: (row) => row.rounds },
    { key: "win", label: "Win%", metric: "ecoSemi", numeric: true, className: "w-[42%]", sortable: true, sortValue: (row) => row.lowWinRate, rankingSample: (row) => row.rounds, render: (row) => <MetricValue metric="ecoSemi" value={{ rate: row.lowWinRate, wins: row.lowEconomyWins, opportunities: row.rounds }} sampleDisplay="compact" /> },
  ];

  return (
    <>
    <div className="space-y-5">
      <section aria-label="Tournament summary" className="border-y border-[var(--color-border)] bg-[var(--color-panel-low)]">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
          <div className="px-4 py-4 lg:border-r lg:border-[var(--color-border)]">
            <p className="text-[11px] uppercase tracking-[var(--tracking-label)] text-[var(--color-fg-mid)]">Matches</p>
            <p className="mt-1.5 text-2xl font-semibold tabular-nums">{data.totals.completedMatches}</p>
          </div>
          <div className="px-4 py-4 lg:border-r lg:border-[var(--color-border)]">
            <p className="text-[11px] uppercase tracking-[var(--tracking-label)] text-[var(--color-fg-mid)]">Maps</p>
            <p className="mt-1.5 text-2xl font-semibold tabular-nums">{data.totals.completedMaps}</p>
          </div>
          <div className="px-4 py-4 lg:border-r lg:border-[var(--color-border)]">
            <p className="text-[11px] uppercase tracking-[var(--tracking-label)] text-[var(--color-fg-mid)]">Rounds</p>
            <p className="mt-1.5 text-2xl font-semibold tabular-nums">{data.totals.completedRounds}</p>
          </div>
          <div className="px-4 py-4 lg:border-r lg:border-[var(--color-border)]">
            <p className="text-[11px] uppercase tracking-[var(--tracking-label)] text-[var(--color-fg-mid)]">Side Split</p>
            <div className="mt-2"><StatsSideSplit ct={data.sideSplit.ct} t={data.sideSplit.t} /></div>
          </div>
          <div className="px-4 py-4">
            <p className="text-[11px] uppercase tracking-[var(--tracking-label)] text-[var(--color-fg-mid)]"><StatsMetricLabel metric="conversion">{STATS_METRICS.conversion.label}</StatsMetricLabel></p>
            <div className="mt-1.5 text-lg font-semibold"><MetricValue metric="conversion" value={data.round2Conversion} sampleDisplay="compact" /></div>
          </div>
        </div>
      </section>

      <section aria-label="Tournament leaders" className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
        <section className="min-w-0">
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">Top Players</h2>
            <Link href={statsHref(seasonSlug, query, { tab: "players" })} scroll={false} className="text-xs text-[var(--color-fg-mid)] transition-colors hover:text-[var(--color-accent)]">View all →</Link>
          </div>
          <div className="border-y border-[var(--color-border)] bg-[var(--color-panel)]">
            <StatsDataTable embedded showRank rows={topPlayers} columns={playerColumns} rowKey={(row, index) => `${row.userId ?? row.perfectName}:${""}:${index}`} pageSize={5} tableClassName="table-fixed" emptyLabel="暂无选手统计" />
          </div>
        </section>
        <section className="min-w-0">
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">Top Teams</h2>
            <Link href={statsHref(seasonSlug, query, { tab: "teams" })} scroll={false} className="text-xs text-[var(--color-fg-mid)] transition-colors hover:text-[var(--color-accent)]">View all →</Link>
          </div>
          <div className="border-y border-[var(--color-border)] bg-[var(--color-panel)]">
            <StatsDataTable embedded showRank rows={topTeams} columns={teamColumns} rowKey={(row) => row.entryId} pageSize={5} tableClassName="table-fixed" emptyLabel="暂无队伍赛果" />
          </div>
        </section>
        <section className="min-w-0">
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">Top Weapons</h2>
            <Link href={statsHref(seasonSlug, query, { tab: "weapons" })} scroll={false} className="text-xs text-[var(--color-fg-mid)] transition-colors hover:text-[var(--color-accent)]">View all →</Link>
          </div>
          <div className="border-y border-[var(--color-border)] bg-[var(--color-panel)]">
            <StatsDataTable embedded showRank rows={topWeapons} columns={weaponColumns} rowKey={(row) => row.weapon} pageSize={5} tableClassName="table-fixed" emptyLabel="暂无武器统计" />
          </div>
        </section>
      </section>

      <section aria-labelledby="maps-heading">
        <div className="mb-3 flex items-end justify-between gap-3">
          <h2 id="maps-heading" className="text-base font-semibold">Maps</h2>
          <span className="text-xs text-[var(--color-fg-dim)]">{maps.length} map{maps.length === 1 ? "" : "s"}</span>
        </div>
        <StatsDataTable rows={maps} columns={mapColumns} rowKey={(row) => row.mapName} initialSortKey="played" tableClassName="table-fixed" />
      </section>

      <Insights insights={data.insights ?? []} query={query} seasonSlug={seasonSlug} />

      <section aria-labelledby="economy-conversion">
        <div className="mb-3 flex items-end justify-between gap-3">
          <h2 id="economy-conversion" className="text-base font-semibold">Economy & Conversion</h2>
          {partialCoverage && <span className="text-xs text-[var(--color-fg-dim)]">Coverage {data.coverage.detailedMaps}/{data.coverage.completedMaps}</span>}
        </div>
        <div className="grid gap-6 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.6fr)]">
          <section className="min-w-0">
            <div className="mb-2.5">
              <h3 className="font-semibold">Economy vs Full Buy</h3>
            </div>
            <div className="border-y border-[var(--color-border)] bg-[var(--color-panel)]">
              <StatsDataTable embedded rows={economyRows} columns={economyColumns} rowKey={(row) => row.lowEconomy} tableClassName="table-fixed" emptyLabel="暂无 Full Buy 对局样本" />
              <div className="flex items-end justify-between gap-4 border-t border-[var(--color-border)] bg-[var(--color-panel-low)] px-4 py-4">
                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-[var(--tracking-label)] text-[var(--color-fg-mid)]"><span className="relative inline-block">Overall vs Full Buy<StatsTooltip className="absolute left-full top-1/2 ml-1 -translate-y-1/2" label="Overall vs Full Buy 统计口径说明" content="汇总 ECO、半起和强起对阵 Full Buy 的回合。" /></span></p>
                </div>
                <div className="shrink-0 text-right tabular-nums">
                  <p className="text-xl font-semibold">{formatPercent(overallEconomy.rate)}</p>
                  <p className="mt-0.5 text-xs text-[var(--color-fg-dim)]">{overallEconomy.wins} / {overallEconomy.rounds} rounds</p>
                </div>
              </div>
            </div>
          </section>

          <section className="min-w-0">
            <div className="mb-2.5">
              <h3 className="font-semibold"><span className="relative inline-block">Round Situations<StatsTooltip className="absolute left-full top-1/2 ml-1 -translate-y-1/2" label="Round Situations 说明" content="各类回合情境下的队伍表现。5v4、5v3 展示人数优势下胜率最低的队伍，其余项目展示最高值；仅比较达到样本门槛的队伍。" /></span></h3>
            </div>
            <div className="grid gap-px border border-[var(--color-border)] bg-[var(--color-border)] sm:grid-cols-3">
              {highlights.map((highlight) => (
                <div key={highlight.key} className="min-w-0 bg-[var(--color-panel-low)] px-3 py-3.5">
                  <p className="text-[11px] uppercase tracking-[var(--tracking-label)] text-[var(--color-fg-mid)]"><StatsMetricLabel metric={highlight.metric}>{highlight.label}</StatsMetricLabel></p>
                  {highlight.team && highlight.value ? (
                    <>
                      <TeamProfileLink profileHref={data.teamLinks?.[highlight.team.entityKey] ?? `/${seasonSlug}/teams/${highlight.team.entityKey}`} className="mt-1.5 block truncate text-sm font-medium hover:text-[var(--color-accent)]">{highlight.team.displayName}</TeamProfileLink>
                      <div className="mt-1 text-lg font-semibold"><MetricValue metric={highlight.metric} value={highlight.value} sampleDisplay="compact" /></div>
                    </>
                  ) : <p className="mt-2 text-sm text-[var(--color-fg-dim)]">—</p>}
                </div>
              ))}
            </div>
          </section>
        </div>
      </section>
    </div>
      <ContentReady module="statistics" phase="primary" />
    </>
  );
}
