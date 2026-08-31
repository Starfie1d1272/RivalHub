import React from "react";
import Link from "next/link";
import { Panel } from "@/components/rivalhub";
import { Button } from "@/components/ui/button";
import type { LeaderboardView } from "@/lib/matches/leaderboard-view";
import { positionLabel } from "@/lib/validators/registration";

interface LeaderboardRow {
  userId: string | null;
  perfectName: string;
  position: string | null;
  teamName: string | null;
  teamId: string | null;
  maps: number;
  avgRating: number;
  avgAdr: number;
  avgRws: number;
  avgWe: number;
  avgHs: number;
  kdRatio: number | null;
  kpr: number;
  fkpr: number;
  mkpr: number;
  cpr: number;
}

interface StatsLeaderboardProps {
  rows: LeaderboardRow[];
  sort: string;
  position: string;
  seasonSlug: string;
  view?: LeaderboardView;
  stages?: { key: string; name: string }[];
  currentStage?: string;
}

const VIEWS: { key: LeaderboardView; label: string; defaultSort: string }[] = [
  { key: "core", label: "Core", defaultSort: "rating" },
  { key: "impact", label: "Impact", defaultSort: "fk" },
  { key: "advanced", label: "Advanced", defaultSort: "we" },
];

const POSITIONS = [
  { key: "",        label: "全部" },
  { key: "igl",    label: "IGL" },
  { key: "awper",  label: "AWPer" },
  { key: "opener", label: "Opener" },
  { key: "closer", label: "Closer" },
  { key: "anchor", label: "Anchor" },
];

interface ColDef {
  key: string;
  label: string;
  getValue: (r: LeaderboardRow) => number | null;
  format: (v: number | null) => string;
}

const BASE_COLS: ColDef[] = [
  {
    key: "maps",
    label: "Maps",
    getValue: (r) => r.maps,
    format: (v) => String(v ?? 0),
  },
];

const CORE_COLS: ColDef[] = [
  ...BASE_COLS,
  {
    key: "rating",
    label: "Rating",
    getValue: (r) => r.avgRating,
    format: (v) => (v ?? 0).toFixed(2),
  },
  {
    key: "adr",
    label: "ADR",
    getValue: (r) => r.avgAdr,
    format: (v) => (v ?? 0).toFixed(1),
  },
  {
    key: "kd",
    label: "K/D",
    getValue: (r) => r.kdRatio,
    format: (v) => (v != null ? v.toFixed(2) : "—"),
  },
  {
    key: "kpr",
    label: "KPR",
    getValue: (r) => r.kpr,
    format: (v) => (v ?? 0).toFixed(2),
  },
  {
    key: "hs",
    label: "HS%",
    getValue: (r) => r.avgHs,
    format: (v) => (v ?? 0).toFixed(1) + "%",
  },
];

const IMPACT_COLS: ColDef[] = [
  ...BASE_COLS,
  {
    key: "rating",
    label: "Rating",
    getValue: (r) => r.avgRating,
    format: (v) => (v ?? 0).toFixed(2),
  },
  {
    key: "fk",
    label: "FKPR /100r",
    getValue: (r) => r.fkpr,
    format: (v) => (v != null ? (v * 100).toFixed(1) : "—"),
  },
  {
    key: "mk",
    label: "MKPR /100r",
    getValue: (r) => r.mkpr,
    format: (v) => (v != null ? (v * 100).toFixed(1) : "—"),
  },
  {
    key: "clutch",
    label: "CPR /100r",
    getValue: (r) => r.cpr,
    format: (v) => (v != null ? (v * 100).toFixed(1) : "—"),
  },
];

const ADVANCED_COLS: ColDef[] = [
  ...BASE_COLS,
  {
    key: "rating",
    label: "Rating",
    getValue: (r) => r.avgRating,
    format: (v) => (v ?? 0).toFixed(2),
  },
  {
    key: "we",
    label: "WE",
    getValue: (r) => r.avgWe,
    format: (v) => (v ?? 0).toFixed(1),
  },
  {
    key: "rws",
    label: "RWS",
    getValue: (r) => r.avgRws,
    format: (v) => (v ?? 0).toFixed(2),
  },
];

const VIEW_COLS: Record<LeaderboardView, ColDef[]> = {
  core: CORE_COLS,
  impact: IMPACT_COLS,
  advanced: ADVANCED_COLS,
};

export function StatsLeaderboard({ rows, sort, position, seasonSlug, view = "core", stages, currentStage = "" }: StatsLeaderboardProps) {
  if (rows.length === 0) {
    return (
      <Panel pad={32} className="text-center text-[var(--color-fg-mid)]">
        该赛季暂无已确认的玩家数据
      </Panel>
    );
  }

  const sortColBg = "color-mix(in srgb, var(--color-accent) 4%, transparent)";
  const accentText = "var(--color-accent)";
  const cols = VIEW_COLS[view];
  const statsHref = ({
    nextSort = sort,
    nextPosition = position,
    nextView = view,
    nextStage = currentStage,
  }: {
    nextSort?: string;
    nextPosition?: string;
    nextView?: LeaderboardView;
    nextStage?: string;
  }) => {
    const params = new URLSearchParams({ sort: nextSort });
    if (nextPosition) params.set("position", nextPosition);
    if (nextView !== "core") params.set("view", nextView);
    if (nextStage) params.set("stage", nextStage);
    return `/${seasonSlug}/stats?${params.toString()}`;
  };

  return (
    <div>
      <div className="flex flex-col gap-3 mb-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase text-[var(--color-fg-dim)] mb-1.5" style={{ fontFamily: "var(--font-mono)" }}>
            Metric view
          </p>
          <div className="flex gap-1 flex-wrap">
            {VIEWS.map(({ key, label, defaultSort }) => (
              <Button key={key} size="sm" variant={view !== key ? "ghost" : "outline"} asChild>
                <a href={statsHref({ nextSort: defaultSort, nextView: key })}>{label}</a>
              </Button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-[11px] font-semibold uppercase text-[var(--color-fg-dim)] mb-1.5" style={{ fontFamily: "var(--font-mono)" }}>
            Sort
          </p>
          <div className="flex gap-1 flex-wrap">
            {cols.map(({ key, label }) => (
              <Button key={key} size="sm" variant={sort !== key ? "ghost" : "outline"} asChild>
                <a href={statsHref({ nextSort: key })}>{label}</a>
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* 阶段筛选（多阶段赛季才显示） */}
      {stages && stages.length > 1 && (
        <div className="flex gap-1 flex-wrap mb-3">
          <p className="w-full text-[11px] font-semibold uppercase text-[var(--color-fg-dim)] mb-1.5" style={{ fontFamily: "var(--font-mono)" }}>
            Stage
          </p>
          <Button size="sm" variant={currentStage !== "" ? "ghost" : "outline"} asChild>
            <a href={statsHref({ nextStage: "" })}>全部</a>
          </Button>
          {stages.map(({ key, name }) => (
            <Button key={key} size="sm" variant={currentStage !== key ? "ghost" : "outline"} asChild>
              <a href={statsHref({ nextStage: key })}>{name}</a>
            </Button>
          ))}
        </div>
      )}

      {/* 位置筛选 */}
      <div className="flex gap-1 flex-wrap mb-4">
        <p className="w-full text-[11px] font-semibold uppercase text-[var(--color-fg-dim)] mb-1.5" style={{ fontFamily: "var(--font-mono)" }}>
          Position
        </p>
        {POSITIONS.map(({ key, label }) => (
          <Button key={key} size="sm" variant={position !== key ? "ghost" : "outline"} asChild>
            <a href={statsHref({ nextPosition: key })}>
              {label}
            </a>
          </Button>
        ))}
      </div>

      {/* 核心视图压进桌面宽度；窄屏仍可横向滚动。 */}
      <Panel pad={0} className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[680px] table-fixed">
            <colgroup>
              <col className="w-9" />
              <col />
              <col className="w-24" />
              <col className="w-[18%]" />
              {cols.map((col) => <col key={col.key} className="w-[8%]" />)}
            </colgroup>
            <thead>
              <tr className="border-b border-[var(--color-border)] text-[var(--color-fg-mid)] text-xs uppercase tracking-wide">
                <th className="px-2.5 py-3 text-left">#</th>
                <th className="px-2.5 py-3 text-left">Player</th>
                <th className="px-2.5 py-3 text-left">Pos</th>
                <th className="px-2.5 py-3 text-left">Team</th>
                {cols.map((col) => (
                  <th
                    key={col.key}
                    className="px-1.5 py-3 text-center whitespace-nowrap"
                    style={sort === col.key ? { background: sortColBg, color: accentText } : undefined}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {rows.map((r, i) => (
                <tr key={r.userId ?? r.perfectName} className="hover:bg-[var(--color-surface-raised)] transition-colors">
                  <td className="px-2.5 py-2.5 text-xs">
                    <span
                      className={i < 3 ? "font-bold" : "text-[var(--color-fg-dim)]"}
                      style={i < 3 ? { color: accentText } : undefined}
                    >
                      {i + 1}
                    </span>
                  </td>
                  <td className="px-2.5 py-2.5 font-medium text-[var(--color-fg)] truncate">
                    {r.userId ? (
                      <Link
                        href={`/players/${r.userId}`}
                        className="hover:text-[var(--color-accent)] transition-colors"
                      >
                        {r.perfectName}
                      </Link>
                    ) : (
                      r.perfectName
                    )}
                  </td>
                  <td className="px-2.5 py-2.5 text-xs text-[var(--color-fg-mid)] whitespace-nowrap">
                    {r.position ? positionLabel(r.position) : "—"}
                  </td>
                  <td className="px-2.5 py-2.5 text-xs text-[var(--color-fg-mid)] truncate">
                    {r.teamId ? (
                      <Link
                        href={`/${seasonSlug}/teams/${r.teamId}`}
                        className="hover:text-[var(--color-accent)] transition-colors"
                      >
                        {r.teamName ?? "—"}
                      </Link>
                    ) : (
                      r.teamName ?? "—"
                    )}
                  </td>
                  {cols.map((col) => {
                    const val = col.getValue(r);
                    const isSort = sort === col.key;
                    const isHighRating = col.key === "rating" && (val ?? 0) >= 1.2;
                    return (
                      <td
                        key={col.key}
                        className={`px-1.5 py-2.5 text-center tabular-nums whitespace-nowrap ${
                          isSort || isHighRating ? "font-semibold" : "text-[var(--color-fg)]"
                        }`}
                        style={
                          isSort
                            ? { background: sortColBg, color: accentText }
                            : isHighRating
                            ? { color: accentText }
                            : undefined
                        }
                      >
                        {col.format(val)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
