import type { Match } from "@/db/schema";

export interface RecentMatchResult {
  matchId: string;
  opponentName: string;
  opponentId: string;
  scoreFor: number | null;
  scoreAgainst: number | null;
  won: boolean;
  format: string;
  playedAt: Date;
}

/** Project a team's latest official series results without recomputing match outcomes. */
export function projectRecentMatchResults(
  entryId: string,
  matches: readonly (Pick<Match, "id" | "entryAId" | "entryBId" | "scoreA" | "scoreB" | "completedAt" | "scheduledAt" | "format"> & { displayScore?: import("./display-score").DisplayScore })[],
  entryNames: ReadonlyMap<string, string>,
  limit = 5,
): RecentMatchResult[] {
  return matches
    .filter((match) => match.scoreA !== null && match.scoreB !== null && (match.entryAId === entryId || match.entryBId === entryId))
    .sort((a, b) => ((b.completedAt ?? b.scheduledAt)?.getTime() ?? 0) - ((a.completedAt ?? a.scheduledAt)?.getTime() ?? 0))
    .slice(0, limit)
    .flatMap((match) => {
      const isA = match.entryAId === entryId;
      const opponentId = isA ? match.entryBId : match.entryAId;
      const display = match.displayScore ?? match;
      const scoreFor = isA ? display.scoreA : display.scoreB;
      const scoreAgainst = isA ? display.scoreB : display.scoreA;
      const playedAt = match.completedAt ?? match.scheduledAt;
      const opponentName = opponentId === null ? undefined : entryNames.get(opponentId);
      if (!playedAt || !opponentName || opponentId === null) return [];
      return [{ matchId: match.id, opponentId, opponentName, scoreFor, scoreAgainst, won: isA ? match.scoreA! > match.scoreB! : match.scoreB! > match.scoreA!, format: match.format, playedAt }];
    });
}
