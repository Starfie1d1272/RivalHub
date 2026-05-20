import React from "react";
import Link from "next/link";
import { Panel, Btn } from "@/components/rivalhub";
import { POSITION_LABELS } from "@/lib/validators/registration";

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
}

const SORT_OPTIONS = [
  { key: "rating",  label: "Rating" },
  { key: "adr",     label: "ADR" },
  { key: "kd",      label: "K/D" },
  { key: "kpr",     label: "KPR" },
  { key: "hs",      label: "HS%" },
  { key: "we",      label: "WE" },
  { key: "rws",     label: "RWS" },
  { key: "fk",      label: "FKPR /100r" },
  { key: "mk",      label: "MKPR /100r" },
  { key: "clutch",  label: "CPR /100r" },
  { key: "maps",    label: "场次" },
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

const COLS: ColDef[] = [
  {
    key: "maps",
    label: "图数",
    getValue: (r) => r.maps,
    format: (v) => String(v ?? 0),
  },
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

export function StatsLeaderboard({ rows, sort, position, seasonSlug }: StatsLeaderboardProps) {
  if (rows.length === 0) {
    return (
      <Panel pad={32} className="text-center text-[var(--color-fg-mid)]">
        该赛季暂无已确认的玩家数据
      </Panel>
    );
  }

  const sortColBg = "rgba(255,107,26,0.04)";
  const accentText = "var(--color-accent)";

  return (
    <div>
      {/* 排序 Tab */}
      <div className="flex gap-1 flex-wrap mb-2">
        {SORT_OPTIONS.map(({ key, label }) => (
          <Btn key={key} small ghost={sort !== key} asChild>
            <a href={`/${seasonSlug}/stats?sort=${key}${position ? `&position=${position}` : ""}`}>
              {label}
            </a>
          </Btn>
        ))}
      </div>

      {/* 位置筛选 */}
      <div className="flex gap-1 flex-wrap mb-4">
        {POSITIONS.map(({ key, label }) => (
          <Btn key={key} small ghost={position !== key} asChild>
            <a href={`/${seasonSlug}/stats?sort=${sort}${key ? `&position=${key}` : ""}`}>
              {label}
            </a>
          </Btn>
        ))}
      </div>

      {/* 表格：min-w 确保桌面端不压缩，移动端横向滚动 */}
      <Panel pad={0} className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-[var(--color-fg-mid)] text-xs uppercase tracking-wide">
                <th className="px-3 py-3 text-left w-8">#</th>
                <th className="px-3 py-3 text-left">选手</th>
                <th className="px-3 py-3 text-left">位置</th>
                <th className="px-3 py-3 text-left">队伍</th>
                {COLS.map((col) => (
                  <th
                    key={col.key}
                    className="px-3 py-3 text-center whitespace-nowrap"
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
                  <td className="px-3 py-2.5 text-xs">
                    <span
                      className={i < 3 ? "font-bold" : "text-[var(--color-fg-dim)]"}
                      style={i < 3 ? { color: accentText } : undefined}
                    >
                      {i + 1}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 font-medium text-[var(--color-fg)]">
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
                  <td className="px-3 py-2.5 text-xs text-[var(--color-fg-mid)]">
                    {r.position
                      ? (POSITION_LABELS[r.position as keyof typeof POSITION_LABELS]?.cn ?? r.position)
                      : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-[var(--color-fg-mid)]">
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
                  {COLS.map((col) => {
                    const val = col.getValue(r);
                    const isSort = sort === col.key;
                    const isHighRating = col.key === "rating" && (val ?? 0) >= 1.2;
                    return (
                      <td
                        key={col.key}
                        className={`px-3 py-2.5 text-center tabular-nums ${
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
