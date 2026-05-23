import Link from "next/link";
import { cn } from "@/lib/utils/cn";
import { Panel } from "@/components/rivalhub";

export interface SummaryPlayer {
  userId: string | null;
  perfectName: string;
  teamId: string;
  kills: number;
  deaths: number;
  assists: number;
  hsPercent: number | null;
  firstKills: number;
  multiKills: number;
  clutches: number;
  adr: number | null;
  rws: number | null;
  ratingPro: number | null;
  we: number | null;
  mapsPlayed: number;
}

interface MatchSummaryStatsProps {
  players: SummaryPlayer[];
  teamAId: string;
  teamBId: string;
  teamAName: string;
  teamBName: string;
  seasonSlug: string;
}

const COLS = [
  { key: "mapsPlayed", label: "图数" },
  { key: "ratingPro", label: "Rating", fmt: (v: number | null) => v != null ? v.toFixed(2) : "—" },
  { key: "adr", label: "ADR", fmt: (v: number | null) => v != null ? v.toFixed(1) : "—" },
  { key: "kills", label: "K" },
  { key: "deaths", label: "D" },
  { key: "assists", label: "A" },
  { key: "hsPercent", label: "HS%", fmt: (v: number | null) => v != null ? `${v.toFixed(0)}%` : "—" },
  { key: "firstKills", label: "FK" },
  { key: "clutches", label: "残局" },
] as const;

interface PlayerRowProps {
  player: SummaryPlayer;
  seasonSlug: string;
}

function PlayerRow({ player, seasonSlug }: PlayerRowProps) {
  const ratingHigh = player.ratingPro != null && player.ratingPro >= 1.2;

  return (
    <tr className="border-b border-[var(--color-border)] last:border-0">
      <td className="py-1.5 pl-3 pr-1 whitespace-nowrap">
        {player.userId ? (
          <Link
            href={`/players/${player.userId}`}
            className="text-sm font-medium hover:text-[var(--color-accent)] transition-colors"
          >
            {player.perfectName}
          </Link>
        ) : (
          <span className="text-sm text-[var(--color-fg)]">{player.perfectName}</span>
        )}
      </td>
      {COLS.map((col) => {
        const raw = player[col.key as keyof SummaryPlayer] as number | null;
        const val = "fmt" in col && col.fmt ? col.fmt(raw) : (raw ?? "—");
        return (
          <td
            key={col.key}
            className={cn(
              "tabular-nums text-right px-1.5 py-1.5 text-xs whitespace-nowrap",
              col.key === "deaths" && "text-[var(--color-fg-mid)]",
            )}
          >
            <span
              className={cn(
                col.key === "ratingPro" && ratingHigh && "font-bold text-[var(--color-accent)]",
              )}
            >
              {String(val)}
            </span>
          </td>
        );
      })}
    </tr>
  );
}

interface TeamBlockProps {
  teamName: string;
  borderColor: string;
  bgColor: string;
  players: SummaryPlayer[];
  seasonSlug: string;
}

function TeamBlock({ teamName, borderColor, bgColor, players, seasonSlug }: TeamBlockProps) {
  if (players.length === 0) return null;
  return (
    <div className="rounded-md overflow-hidden" style={{ backgroundColor: bgColor }}>
      <div
        className="px-3 py-2 text-[11px] font-bold tracking-widest uppercase"
        style={{ borderLeft: `3px solid ${borderColor}` }}
      >
        {teamName}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full" style={{ minWidth: 560 }}>
          <thead>
            <tr className="border-b border-[var(--color-border)]">
              <th className="text-left text-[10px] text-[var(--color-fg-dim)] font-medium py-1 pl-3 pr-1 whitespace-nowrap">
                选手
              </th>
              {COLS.map((col) => (
                <th
                  key={col.key}
                  className="text-right text-[10px] text-[var(--color-fg-dim)] font-medium px-1.5 py-1 whitespace-nowrap"
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {players.map((p) => (
              <PlayerRow key={p.userId ?? p.perfectName} player={p} seasonSlug={seasonSlug} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function MatchSummaryStats({
  players,
  teamAId,
  teamBId,
  teamAName,
  teamBName,
  seasonSlug,
}: MatchSummaryStatsProps) {
  const teamAPlayers = players.filter((p) => p.teamId === teamAId);
  const teamBPlayers = players.filter((p) => p.teamId === teamBId);

  return (
    <Panel pad={12} className="space-y-4">
      <TeamBlock
        teamName={teamAName}
        borderColor="var(--color-accent)"
        bgColor="rgba(77,212,122,0.04)"
        players={teamAPlayers}
        seasonSlug={seasonSlug}
      />
      <TeamBlock
        teamName={teamBName}
        borderColor="var(--color-accent-b)"
        bgColor="rgba(66,170,255,0.04)"
        players={teamBPlayers}
        seasonSlug={seasonSlug}
      />
    </Panel>
  );
}
