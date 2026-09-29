import React from "react";
import { MatchSummaryStats, type SummaryPlayer } from "./MatchSummaryStats";

interface PlayerStatsTableProps {
  players: SummaryPlayer[];
  entryAId: string;
  entryBId: string;
  teamAName: string;
  teamBName: string;
}

export function PlayerStatsTable({
  players,
  entryAId,
  entryBId,
  teamAName,
  teamBName,
}: PlayerStatsTableProps) {
  if (players.length === 0) {
    return <p className="text-xs text-[var(--color-fg-dim)] py-2">暂无玩家数据</p>;
  }

  return (
    <MatchSummaryStats
      players={players}
      entryAId={entryAId}
      entryBId={entryBId}
      teamAName={teamAName}
      teamBName={teamBName}
      noPanel
    />
  );
}
