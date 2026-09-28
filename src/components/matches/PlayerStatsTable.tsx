import React from "react";
import { MatchSummaryStats, type SummaryPlayer } from "./MatchSummaryStats";

interface PlayerStatsTableProps {
  players: SummaryPlayer[];
  entryAId: string;
  entryBId: string;
  teamAName: string;
  teamBName: string;
}

/** Public per-map scoreboard presentation; all stats and team ownership come from the match read model. */
export function PlayerStatsTable({ players, entryAId, entryBId, teamAName, teamBName }: PlayerStatsTableProps) {
  if (players.length === 0) return <p className="py-2 text-xs text-[var(--color-fg-dim)]">暂无玩家数据</p>;
  return <MatchSummaryStats players={players} entryAId={entryAId} entryBId={entryBId} teamAName={teamAName} teamBName={teamBName} noPanel />;
}
