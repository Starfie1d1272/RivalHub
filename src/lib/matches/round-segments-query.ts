import "server-only";

import { inArray } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { db } from "@/db/client";
import { matchRoundFacts } from "@/db/schema";
import { PUBLIC_STATS_TAG } from "@/lib/cache/tags";
import { loadStatsContext } from "@/lib/stats/tournament-scope";
import { getRoundSegments, type RoundSegments } from "./round-segments";

/** One bounded read of rounds belonging to the current valid imports of this match. */
export async function getMatchRoundSegments(matchId: string): Promise<Record<string, RoundSegments>> {
  "use cache: remote";
  cacheTag(PUBLIC_STATS_TAG);
  cacheLife({ stale: 60, revalidate: Infinity, expire: Infinity });
  return db.transaction(async (tx) => {
    const { currentRefs } = await loadStatsContext(tx, {}, { matchIds: [matchId], skipLabels: true });
    if (!currentRefs.length) return {};
    const rounds = await tx.select({
      importId: matchRoundFacts.importId,
      roundSeq: matchRoundFacts.roundSeq,
      phase: matchRoundFacts.phase,
      teamASide: matchRoundFacts.teamASide,
      teamBSide: matchRoundFacts.teamBSide,
      teamAScoreBefore: matchRoundFacts.teamAScoreBefore,
      teamBScoreBefore: matchRoundFacts.teamBScoreBefore,
      winnerTeamKey: matchRoundFacts.winnerTeamKey,
    }).from(matchRoundFacts).where(inArray(matchRoundFacts.importId, currentRefs.map(({ current }) => current.id)));
    const byImport = Map.groupBy(rounds, (round) => round.importId);
    return Object.fromEntries(currentRefs.flatMap(({ current, map }) => {
      const segments = getRoundSegments(byImport.get(current.id) ?? [], map.scoreA!, map.scoreB!);
      return segments ? [[map.id, segments]] : [];
    }));
  });
}
