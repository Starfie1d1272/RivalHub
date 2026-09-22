import React from "react";
import Link from "next/link";
import type { Route } from "next";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/rivalhub";
import { StatsTable, type StatsTableColumn } from "@/components/stats/StatsTable";
import type { LeaderboardView } from "@/lib/matches/leaderboard-view";
import { statsHref as tournamentHref, type StatsQuery } from "@/lib/stats/query-state";
import type { StatsSortDirection } from "@/lib/stats/sorting";
import { formatNumber, formatStat } from "@/lib/stats";

interface LeaderboardRow {
  userId: string | null;
  perfectName: string;
  position?: string | null;
  teamName: string | null;
  teamId: string | null;
  maps: number;
  avgRating: number | null;
  avgAdr: number | null;
  avgRws: number | null;
  avgWe: number | null;
  avgHs: number | null;
  kdRatio: number | null;
  kpr: number | null;
  fkpr: number | null;
  mkpr: number | null;
  cpr: number | null;
  fdpr?: number | null;
  tradeKpr?: number | null;
  kast?: number | null;
}

interface StatsLeaderboardProps {
  rows: LeaderboardRow[];
  sort: string;
  direction?: StatsSortDirection;
  position?: string;
  query?: StatsQuery;
  seasonSlug: string;
  view?: LeaderboardView;
  rankOffset?: number;
}

const VIEWS: { key: LeaderboardView; label: string; defaultSort: string }[] = [
  { key: "core", label: "Core", defaultSort: "rating" },
  { key: "impact", label: "Impact", defaultSort: "fk" },
  { key: "advanced", label: "Advanced", defaultSort: "we" },
];

interface MetricColumn {
  key: string;
  label: string;
  getValue: (row: LeaderboardRow) => number | null;
  format: (value: number | null) => string;
}

const BASE_COLS: MetricColumn[] = [
  { key: "maps", label: "Maps", getValue: (row) => row.maps, format: (value) => formatNumber(value, 0) },
];

const CORE_COLS: MetricColumn[] = [
  ...BASE_COLS,
  { key: "rating", label: "Rating", getValue: (row) => row.avgRating, format: (value) => formatStat("ratingPro", value) },
  { key: "adr", label: "ADR", getValue: (row) => row.avgAdr, format: (value) => formatStat("adr", value) },
  { key: "kd", label: "K/D", getValue: (row) => row.kdRatio, format: (value) => formatStat("kd", value) },
  { key: "kpr", label: "KPR", getValue: (row) => row.kpr, format: (value) => formatStat("kpr", value) },
  { key: "hs", label: "HS%", getValue: (row) => row.avgHs, format: (value) => formatStat("hsPercent", value) },
];

const IMPACT_COLS: MetricColumn[] = [
  ...BASE_COLS,
  { key: "rating", label: "Rating", getValue: (row) => row.avgRating, format: (value) => formatStat("ratingPro", value) },
  { key: "fk", label: "FKPR /100r", getValue: (row) => row.fkpr, format: (value) => formatStat("fkpr", value) },
  { key: "mk", label: "MKPR /100r", getValue: (row) => row.mkpr, format: (value) => formatStat("mkpr", value) },
  { key: "clutch", label: "CPR /100r", getValue: (row) => row.cpr, format: (value) => formatStat("cpr", value) },
];

const ADVANCED_COLS: MetricColumn[] = [
  ...BASE_COLS,
  { key: "rating", label: "Rating", getValue: (row) => row.avgRating, format: (value) => formatStat("ratingPro", value) },
  { key: "kast", label: "KAST", getValue: (row) => row.kast ?? null, format: (value) => value === null ? "—" : `${(value * 100).toFixed(1)}%` },
  { key: "fd", label: "FDPR /100r", getValue: (row) => row.fdpr ?? null, format: (value) => value === null ? "—" : (value * 100).toFixed(1) },
  { key: "trade", label: "Trade /100r", getValue: (row) => row.tradeKpr ?? null, format: (value) => value === null ? "—" : (value * 100).toFixed(1) },
  { key: "we", label: "WE", getValue: (row) => row.avgWe, format: (value) => formatStat("we", value) },
  { key: "rws", label: "RWS", getValue: (row) => row.avgRws, format: (value) => formatStat("rws", value) },
];

const VIEW_COLS: Record<LeaderboardView, MetricColumn[]> = { core: CORE_COLS, impact: IMPACT_COLS, advanced: ADVANCED_COLS };

function metricColumns(columns: MetricColumn[], accentText: string, sort: string): StatsTableColumn<LeaderboardRow>[] {
  return columns.map((column) => ({
    key: column.key,
    label: column.label,
    numeric: true,
    sortable: true,
    render: (row) => {
      const value = column.getValue(row);
      const isHighRating = column.key === "rating" && value != null && value >= 1.2;
      return <span className={sort === column.key || isHighRating ? "font-semibold" : undefined} style={isHighRating ? { color: accentText } : undefined}>{column.format(value)}</span>;
    },
  }));
}

export function StatsLeaderboard({ rows, sort, direction = "desc", query, seasonSlug, view = "core", rankOffset = 0 }: StatsLeaderboardProps) {
  if (rows.length === 0) return <EmptyState title="该赛季暂无已确认的玩家数据" />;

  const accentText = "var(--color-accent)";
  const cols = VIEW_COLS[view];
  const viewHref = (nextSort: string, nextDirection: StatsSortDirection, nextView: LeaderboardView = view): Route => {
    if (query) return tournamentHref(seasonSlug, query, { sort: nextSort, dir: nextDirection, view: nextView, tab: "players", page: 1 });
    const params = new URLSearchParams();
    if (nextSort !== "rating") params.set("sort", nextSort);
    if (nextDirection !== "desc") params.set("dir", nextDirection);
    if (nextView !== "core") params.set("view", nextView);
    return `/${seasonSlug}/stats${params.size ? `?${params}` : ""}` as Route;
  };
  const sortHref = (nextSort: string, nextDirection: StatsSortDirection) => viewHref(nextSort, nextDirection);
  const tableColumns: StatsTableColumn<LeaderboardRow>[] = [
    {
      key: "player",
      label: "Player",
      render: (row) => row.userId ? <Link href={`/players/${row.userId}`} className="font-medium hover:text-[var(--color-accent)]">{row.perfectName}</Link> : <span className="font-medium">{row.perfectName}</span>,
    },
    {
      key: "team",
      label: "Team",
      render: (row) => row.teamId ? <Link href={`/${seasonSlug}/teams/${row.teamId}`} className="text-xs text-[var(--color-fg-mid)] hover:text-[var(--color-accent)]">{row.teamName ?? "—"}</Link> : <span className="text-xs text-[var(--color-fg-mid)]">{row.teamName ?? "—"}</span>,
    },
    ...metricColumns(cols, accentText, sort),
  ];

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-fg-dim)]" style={{ fontFamily: "var(--font-mono)" }}>Metric view</p>
        <div className="flex flex-wrap gap-1">
          {VIEWS.map(({ key, label, defaultSort }) => (
            <Button key={key} size="sm" variant={view !== key ? "ghost" : "outline"} asChild>
              <a href={viewHref(defaultSort, "desc", key)}>{label}</a>
            </Button>
          ))}
        </div>
      </div>
      <StatsTable
        rows={rows}
        columns={tableColumns}
        rowKey={(row) => `${row.userId ?? row.perfectName}:${row.teamId ?? ""}`}
        sort={sort}
        direction={direction}
        sortHref={sortHref}
        rankOffset={rankOffset}
        tableClassName="min-w-[680px] table-fixed"
      />
    </div>
  );
}
