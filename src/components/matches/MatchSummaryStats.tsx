import React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils/cn";
import { Panel } from "@/components/rivalhub";
import { formatStat, type StatMetric } from "@/lib/stats";

export interface SummaryPlayer {
  userId: string | null;
  perfectName: string;
  teamId: string;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  hsPercent: number | null;
  firstKills: number | null;
  multiKills: number | null;
  clutches: number | null;
  adr: number | null;
  rws: number | null;
  ratingPro: number | null;
  we: number | null;
  mapsPlayed: number;
}

interface MatchSummaryStatsProps {
  players: SummaryPlayer[];
  entryAId: string;
  entryBId: string;
  teamAName: string;
  teamBName: string;
  /** 不包裹 Panel，供外部已有 Panel 包裹的场景使用（如单图 tab） */
  noPanel?: boolean;
}

const COLS = [
  { key: "ratingPro", label: "Rating", metric: "ratingPro" },
  { key: "kills",     label: "K",      metric: "kills" },
  { key: "deaths",    label: "D",      metric: "deaths" },
  { key: "assists",   label: "A",      metric: "assists" },
  { key: "adr",       label: "ADR",    metric: "adr" },
  { key: "hsPercent", label: "HS%",    metric: "hsPercent" },
  { key: "firstKills",label: "FK",     metric: "firstKills" },
  { key: "multiKills",label: "MK",     metric: "multiKills" },
  { key: "clutches",  label: "CL",     metric: "clutches" },
  { key: "we",        label: "WE",     metric: "we" },
] as const satisfies readonly { key: keyof SummaryPlayer; label: string; metric: StatMetric }[];

/** 按 Rating Pro 降序排序，null 排末尾 */
function byRatingDesc(a: SummaryPlayer, b: SummaryPlayer): number {
  if (a.ratingPro == null && b.ratingPro == null) return 0;
  if (a.ratingPro == null) return 1;
  if (b.ratingPro == null) return -1;
  return b.ratingPro - a.ratingPro;
}

interface PlayerRowProps {
  player: SummaryPlayer;
}

function PlayerRow({ player }: PlayerRowProps) {
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
        const raw = player[col.key];
        const val = formatStat(col.metric, raw as number | null);
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
}

function TeamBlock({ teamName, borderColor, bgColor, players }: TeamBlockProps) {
  if (players.length === 0) return null;
  return (
    <div className="rounded-sm overflow-hidden" style={{ backgroundColor: bgColor }}>
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
              <PlayerRow key={p.userId ?? p.perfectName} player={p} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function MatchSummaryStats({
  players,
  entryAId,
  entryBId,
  teamAName,
  teamBName,
  noPanel = false,
}: MatchSummaryStatsProps) {
  const teamAPlayers = players.filter((p) => p.teamId === entryAId).sort(byRatingDesc);
  const teamBPlayers = players.filter((p) => p.teamId === entryBId).sort(byRatingDesc);

  const content = (
    <React.Fragment>
      <TeamBlock
        teamName={teamAName}
        borderColor="var(--color-accent)"
        bgColor="color-mix(in srgb, var(--color-accent) 4%, transparent)"
        players={teamAPlayers}
      />
      <TeamBlock
        teamName={teamBName}
        borderColor="var(--color-accent-b)"
        bgColor="color-mix(in srgb, var(--color-accent-b) 4%, transparent)"
        players={teamBPlayers}
      />
    </React.Fragment>
  );

  if (noPanel) return content;

  return (
    <Panel contentClassName="space-y-4 p-3">
      {content}
    </Panel>
  );
}
