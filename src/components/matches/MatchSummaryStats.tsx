import Link from "next/link";
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

const COL_HEADER_STYLE: React.CSSProperties = {
  color: "var(--color-fg-dim)",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.05em",
  textTransform: "uppercase" as const,
  textAlign: "right" as const,
  padding: "4px 8px",
  whiteSpace: "nowrap",
};

const CELL_STYLE: React.CSSProperties = {
  color: "var(--color-fg)",
  fontSize: 13,
  textAlign: "right" as const,
  padding: "6px 8px",
  fontFamily: "var(--font-mono)",
  whiteSpace: "nowrap",
};

function fmt1(v: number | null): string {
  return v != null ? v.toFixed(1) : "—";
}

function fmt2(v: number | null): string {
  return v != null ? v.toFixed(2) : "—";
}

function fmtPct(v: number | null): string {
  return v != null ? `${v.toFixed(0)}%` : "—";
}

interface PlayerRowProps {
  player: SummaryPlayer;
  seasonSlug: string;
}

function PlayerRow({ player, seasonSlug }: PlayerRowProps) {
  const ratingHigh = player.ratingPro != null && player.ratingPro >= 1.2;

  return (
    <tr className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-panel-hi)] transition-colors">
      {/* 选手名 */}
      <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>
        {player.userId ? (
          <Link
            href={`/players/${player.userId}`}
            className="text-sm font-medium hover:underline"
            style={{ color: "var(--color-fg)" }}
          >
            {player.perfectName}
          </Link>
        ) : (
          <span className="text-sm" style={{ color: "var(--color-fg)" }}>
            {player.perfectName}
          </span>
        )}
      </td>

      {/* 图数 */}
      <td style={CELL_STYLE}>{player.mapsPlayed}</td>

      {/* Rating */}
      <td
        style={{
          ...CELL_STYLE,
          color: ratingHigh ? "var(--color-accent)" : "var(--color-fg)",
          fontWeight: ratingHigh ? 700 : 400,
        }}
      >
        {fmt2(player.ratingPro)}
      </td>

      {/* ADR */}
      <td style={CELL_STYLE}>{fmt1(player.adr)}</td>

      {/* K */}
      <td style={CELL_STYLE}>{player.kills}</td>

      {/* D */}
      <td style={{ ...CELL_STYLE, color: "var(--color-fg-mid)" }}>{player.deaths}</td>

      {/* A */}
      <td style={CELL_STYLE}>{player.assists}</td>

      {/* HS% */}
      <td style={CELL_STYLE}>{fmtPct(player.hsPercent)}</td>

      {/* FK */}
      <td style={CELL_STYLE}>{player.firstKills}</td>

      {/* 残局 */}
      <td style={CELL_STYLE}>{player.clutches}</td>
    </tr>
  );
}

interface TeamSectionProps {
  teamName: string;
  teamColor: string;
  players: SummaryPlayer[];
  seasonSlug: string;
}

function TeamSection({ teamName, teamColor, players, seasonSlug }: TeamSectionProps) {
  return (
    <>
      <tr>
        <td
          colSpan={10}
          style={{
            padding: "10px 8px 4px",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: teamColor,
          }}
        >
          {teamName}
        </td>
      </tr>
      {players.map((p) => (
        <PlayerRow key={p.userId ?? p.perfectName} player={p} seasonSlug={seasonSlug} />
      ))}
    </>
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
    <Panel pad={0}>
      <div className="overflow-x-auto">
        <table className="w-full" style={{ minWidth: 600 }}>
          <thead>
            <tr className="border-b border-[var(--color-border)]">
              <th style={{ ...COL_HEADER_STYLE, textAlign: "left" }}>选手</th>
              <th style={COL_HEADER_STYLE}>图数</th>
              <th style={COL_HEADER_STYLE}>Rating</th>
              <th style={COL_HEADER_STYLE}>ADR</th>
              <th style={COL_HEADER_STYLE}>K</th>
              <th style={COL_HEADER_STYLE}>D</th>
              <th style={COL_HEADER_STYLE}>A</th>
              <th style={COL_HEADER_STYLE}>HS%</th>
              <th style={COL_HEADER_STYLE}>FK</th>
              <th style={COL_HEADER_STYLE}>残局</th>
            </tr>
          </thead>
          <tbody>
            {teamAPlayers.length > 0 && (
              <TeamSection
                teamName={teamAName}
                teamColor="var(--color-accent)"
                players={teamAPlayers}
                seasonSlug={seasonSlug}
              />
            )}
            {teamBPlayers.length > 0 && (
              <TeamSection
                teamName={teamBName}
                teamColor="var(--color-accent-b)"
                players={teamBPlayers}
                seasonSlug={seasonSlug}
              />
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
