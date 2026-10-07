import type { Match } from "@/db/schema";

export interface RecentMatchResult {
  matchId: string;
  opponentName: string;
  scoreFor: number;
  scoreAgainst: number;
  won: boolean;
  format: string;
  playedAt: Date;
}

/** Project a team's latest official series results without recomputing match outcomes. */
export function projectRecentMatchResults(
  entryId: string,
  matches: readonly Pick<Match, "id" | "entryAId" | "entryBId" | "scoreA" | "scoreB" | "completedAt" | "scheduledAt" | "format">[],
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
      const scoreFor = isA ? match.scoreA! : match.scoreB!;
      const scoreAgainst = isA ? match.scoreB! : match.scoreA!;
      const playedAt = match.completedAt ?? match.scheduledAt;
      const opponentName = opponentId === null ? undefined : entryNames.get(opponentId);
      if (!playedAt || !opponentName) return [];
      return [{ matchId: match.id, opponentName, scoreFor, scoreAgainst, won: scoreFor > scoreAgainst, format: match.format, playedAt }];
    });
}
