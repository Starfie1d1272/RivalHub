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

export function StatsLeaderboard({
  rows,
  sort,
  position,
  seasonSlug,
}: StatsLeaderboardProps) {
  if (rows.length === 0) {
    return (
      <Card className="p-8 text-center text-[var(--text-secondary)]">
        该赛季暂无已确认的玩家数据
      </Card>
    );
  }

  return (
    <div>
      {/* 排序 Tab */}
      <div className="flex gap-1 flex-wrap mb-2">
        {SORT_OPTIONS.map(({ key, label }) => (
          <a
            key={key}
            href={`/${seasonSlug}/stats?sort=${key}${position ? `&position=${position}` : ""}`}
            className={`inline-block px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              sort === key
                ? "bg-[var(--season-primary)] text-white"
                : "border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
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
            className={`inline-block px-2.5 py-1 rounded text-[11px] transition-colors ${
              position === key
                ? "bg-[var(--bg-overlay)] text-[var(--text-primary)] font-medium"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            {label}
          </a>
        ))}
      </div>

      {/* 表格 */}
      <Card className="p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-[var(--text-secondary)] text-xs uppercase tracking-wide">
              <th className="px-4 py-3 text-left w-8">#</th>
              <th className="px-4 py-3 text-left">选手</th>
              <th className="px-4 py-3 text-left">位置</th>
              <th className="px-4 py-3 text-left">队伍</th>
              <th className="px-4 py-3 text-center">图数</th>
              <th className="px-4 py-3 text-center">Rating</th>
              <th className="px-4 py-3 text-center">ADR</th>
              <th className="px-4 py-3 text-center">K/D</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {rows.map((r, i) => (
              <tr key={r.userId ?? r.perfectName}>
                <td className="px-4 py-3 text-[var(--text-muted)] text-xs">
                  {i + 1}
                </td>
                <td className="px-4 py-3 font-medium text-[var(--text-primary)]">
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
                <td className="px-4 py-3 text-xs text-[var(--text-secondary)]">
                  {r.position
                    ? POSITION_LABELS[r.position as keyof typeof POSITION_LABELS]?.cn ?? r.position
                    : "—"}
                </td>
                <td className="px-4 py-3 text-xs text-[var(--text-secondary)]">
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
                <td className="px-4 py-3 text-center tabular-nums text-[var(--text-secondary)]">
                  {r.maps}
                </td>
                <td
                  className={`px-4 py-3 text-center tabular-nums font-semibold ${
                    r.avgRating >= 1.2
                      ? "text-[var(--season-primary)]"
                      : "text-[var(--text-primary)]"
                  }`}
                >
                  {r.avgRating.toFixed(2)}
                </td>
                <td className="px-4 py-3 text-center tabular-nums text-[var(--text-primary)]">
                  {r.avgAdr.toFixed(1)}
                </td>
                <td className="px-4 py-3 text-center tabular-nums text-[var(--text-primary)]">
                  {r.avgDeaths > 0
                    ? (r.avgKills / r.avgDeaths).toFixed(2)
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
