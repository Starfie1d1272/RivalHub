import React from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
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
  avgKills: number;
  avgDeaths: number;
  avgWe: number;
}

interface StatsLeaderboardProps {
  rows: LeaderboardRow[];
  sort: string;
  position: string;
  seasonSlug: string;
}

const SORT_OPTIONS = [
  { key: "rating", label: "Rating" },
  { key: "adr", label: "ADR" },
  { key: "kd", label: "K/D" },
  { key: "we", label: "WE" },
  { key: "kpr", label: "KPR" },
  { key: "maps", label: "场次" },
];

const POSITIONS = [
  { key: "", label: "全部位置" },
  { key: "igl", label: "IGL" },
  { key: "awper", label: "AWPer" },
  { key: "opener", label: "Opener" },
  { key: "closer", label: "Closer" },
  { key: "anchor", label: "Anchor" },
];

// 列 key → 表格列对应关系
const SORT_COL_MAP: Record<string, string> = {
  rating: "rating",
  adr: "adr",
  kd: "kd",
  we: "we",
  kpr: "kpr",
  maps: "maps",
};

export function StatsLeaderboard({
  rows,
  sort,
  position,
  seasonSlug,
}: StatsLeaderboardProps) {
  if (rows.length === 0) {
    return (
      <Card className="p-8 text-center text-[var(--color-fg-mid)]">
        该赛季暂无已确认的玩家数据
      </Card>
    );
  }

  const sortColBg = "rgba(255,107,26,0.04)";
  const accentText = "var(--color-accent)";

  return (
    <div>
      {/* 排序 Tab */}
      <div className="flex gap-1 flex-wrap mb-2">
        {SORT_OPTIONS.map(({ key, label }) => (
          <a
            key={key}
            href={`/${seasonSlug}/stats?sort=${key}${position ? `&position=${position}` : ""}`}
            className={`inline-block font-mono text-[10px] px-2.5 py-1 uppercase tracking-wider rounded transition-colors ${
              sort === key
                ? "bg-[var(--color-accent)] text-[var(--color-accent-fg)]"
                : "border border-[var(--color-border)] text-[var(--color-fg-mid)] hover:text-[var(--color-fg)]"
            }`}
          >
            {label}
          </a>
        ))}
      </div>

      {/* 位置筛选 */}
      <div className="flex gap-1 flex-wrap mb-4">
        {POSITIONS.map(({ key, label }) => (
          <a
            key={key}
            href={`/${seasonSlug}/stats?sort=${sort}${key ? `&position=${key}` : ""}`}
            className={`inline-block font-mono text-[10px] px-2.5 py-1 uppercase tracking-wider rounded transition-colors ${
              position === key
                ? "bg-[var(--color-accent)] text-[var(--color-accent-fg)]"
                : "border border-[var(--color-border)] text-[var(--color-fg-mid)] hover:text-[var(--color-fg)]"
            }`}
          >
            {label}
          </a>
        ))}
      </div>

      {/* 表格 */}
      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[480px]">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-[var(--color-fg-mid)] text-xs uppercase tracking-wide">
              <th className="px-4 py-3 text-left w-8">#</th>
              <th className="px-4 py-3 text-left">选手</th>
              <th className="px-4 py-3 text-left hidden sm:table-cell">位置</th>
              <th className="px-4 py-3 text-left hidden sm:table-cell">队伍</th>
              <th
                className="px-4 py-3 text-center hidden sm:table-cell"
                style={SORT_COL_MAP[sort] === "maps" ? { background: sortColBg, color: accentText } : undefined}
              >
                图数
              </th>
              <th
                className="px-4 py-3 text-center"
                style={SORT_COL_MAP[sort] === "rating" ? { background: sortColBg, color: accentText } : undefined}
              >
                Rating
              </th>
              <th
                className="px-4 py-3 text-center hidden sm:table-cell"
                style={SORT_COL_MAP[sort] === "adr" ? { background: sortColBg, color: accentText } : undefined}
              >
                ADR
              </th>
              <th
                className="px-4 py-3 text-center hidden sm:table-cell"
                style={SORT_COL_MAP[sort] === "kd" ? { background: sortColBg, color: accentText } : undefined}
              >
                K/D
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {rows.map((r, i) => (
              <tr key={r.userId ?? r.perfectName}>
                <td className="px-4 py-3 text-xs">
                  <span
                    className={i < 3 ? "font-bold" : "text-[var(--color-fg-dim)]"}
                    style={i < 3 ? { color: accentText } : undefined}
                  >
                    {i + 1}
                  </span>
                </td>
                <td className="px-4 py-3 font-medium text-[var(--color-fg)]">
                  {r.userId ? (
                    <Link
                      href={`/players/${r.userId}`}
                      className="hover:text-[var(--primary)] transition-colors"
                    >
                      {r.perfectName}
                    </Link>
                  ) : (
                    r.perfectName
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-[var(--color-fg-mid)] hidden sm:table-cell">
                  {r.position
                    ? POSITION_LABELS[r.position as keyof typeof POSITION_LABELS]?.cn ?? r.position
                    : "—"}
                </td>
                <td className="px-4 py-3 text-xs text-[var(--color-fg-mid)] hidden sm:table-cell">
                  {r.teamId ? (
                    <Link
                      href={`/${seasonSlug}/teams/${r.teamId}`}
                      className="hover:text-[var(--primary)] transition-colors"
                    >
                      {r.teamName ?? "—"}
                    </Link>
                  ) : (
                    r.teamName ?? "—"
                  )}
                </td>
                <td
                  className={`px-4 py-3 text-center tabular-nums hidden sm:table-cell ${
                    sort === "maps" ? "font-semibold" : "text-[var(--color-fg-mid)]"
                  }`}
                  style={
                    sort === "maps"
                      ? { background: sortColBg, color: accentText }
                      : undefined
                  }
                >
                  {r.maps}
                </td>
                <td
                  className={`px-4 py-3 text-center tabular-nums font-semibold ${
                    r.avgRating >= 1.2 || sort === "rating"
                      ? "text-[var(--color-accent)]"
                      : "text-[var(--color-fg)]"
                  }`}
                  style={sort === "rating" ? { background: sortColBg } : undefined}
                >
                  {r.avgRating.toFixed(2)}
                </td>
                <td
                  className={`px-4 py-3 text-center tabular-nums hidden sm:table-cell ${
                    sort === "adr" ? "font-semibold" : "text-[var(--color-fg)]"
                  }`}
                  style={
                    sort === "adr"
                      ? { background: sortColBg, color: accentText }
                      : undefined
                  }
                >
                  {r.avgAdr.toFixed(1)}
                </td>
                <td
                  className={`px-4 py-3 text-center tabular-nums hidden sm:table-cell ${
                    sort === "kd" ? "font-semibold" : "text-[var(--color-fg)]"
                  }`}
                  style={
                    sort === "kd"
                      ? { background: sortColBg, color: accentText }
                      : undefined
                  }
                >
                  {r.avgDeaths > 0
                    ? (r.avgKills / r.avgDeaths).toFixed(2)
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </Card>
    </div>
  );
}
