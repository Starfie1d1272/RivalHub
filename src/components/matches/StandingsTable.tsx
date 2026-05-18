import Link from "next/link";
import type { TeamStanding } from "@/lib/standings";

interface StandingsTableProps {
  standings: TeamStanding[];
  seasonSlug: string;
  /** 是否所有排位赛均已结束（决定是否展示"最终"徽章） */
  isFinal: boolean;
}

export function StandingsTable({ standings, seasonSlug, isFinal }: StandingsTableProps) {
  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)]">
            <th className="text-left py-2 px-3 font-medium text-[var(--color-fg-mid)] w-10">#</th>
            <th className="text-left py-2 px-3 font-medium text-[var(--color-fg-mid)]">队伍</th>
            <th className="text-center py-2 px-3 font-medium text-[var(--color-fg-mid)]">胜</th>
            <th className="text-center py-2 px-3 font-medium text-[var(--color-fg-mid)]">负</th>
            <th className="text-center py-2 px-3 font-medium text-[var(--color-fg-mid)]">净胜回合</th>
            <th className="text-center py-2 px-3 font-medium text-[var(--color-fg-mid)]">总胜回合</th>
          </tr>
        </thead>
        <tbody>
          {standings.map((s) => (
            <tr
              key={s.teamId}
              className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-panel-hi)] transition-colors"
            >
              <td className="py-3 px-3 text-[var(--color-fg-mid)] tabular-nums">
                {isFinal ? (
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[var(--primary)]/10 text-[var(--primary)] font-bold text-xs">
                    {s.seed}
                  </span>
                ) : (
                  s.seed
                )}
              </td>
              <td className="py-3 px-3">
                <Link
                  href={`/${seasonSlug}/teams/${s.teamId}`}
                  className="font-semibold text-[var(--color-fg)] hover:text-[var(--primary)] transition-colors"
                >
                  {s.teamName}
                </Link>
              </td>
              <td className="py-3 px-3 text-center tabular-nums text-[var(--color-ok)] font-medium">
                {s.wins}
              </td>
              <td className="py-3 px-3 text-center tabular-nums text-[var(--color-danger)] font-medium">
                {s.losses}
              </td>
              <td className="py-3 px-3 text-center tabular-nums text-[var(--color-fg)]">
                {s.netRounds > 0 ? `+${s.netRounds}` : s.netRounds}
              </td>
              <td className="py-3 px-3 text-center tabular-nums text-[var(--color-fg-mid)]">
                {s.totalRoundsWon}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
