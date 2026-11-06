import "server-only";

import { inArray } from "drizzle-orm";
import { db, type TxDb } from "@/db/client";
import { matchRoundFacts } from "@/db/schema";
import { loadCurrentProjectionRefs, loadStatsContext } from "@/lib/stats/tournament-scope";
import { getRoundSegments, type RoundSegments } from "./round-segments";

/** One bounded read of rounds belonging to the current valid imports of this match. */
export async function loadMatchRoundSegments(
  tx: TxDb,
  currentRefs: Awaited<ReturnType<typeof loadStatsContext>>["currentRefs"],
): Promise<Record<string, RoundSegments>> {
  if (!currentRefs.length) return {};
  const rounds = await tx
    .select({
      importId: matchRoundFacts.importId,
      roundSeq: matchRoundFacts.roundSeq,
      phase: matchRoundFacts.phase,
      teamASide: matchRoundFacts.teamASide,
      teamBSide: matchRoundFacts.teamBSide,
      teamAScoreBefore: matchRoundFacts.teamAScoreBefore,
      teamBScoreBefore: matchRoundFacts.teamBScoreBefore,
      winnerTeamKey: matchRoundFacts.winnerTeamKey,
    })
    .from(matchRoundFacts)
    .where(
      inArray(
        matchRoundFacts.importId,
        currentRefs.map(({ current }) => current.id),
      ),
    );
  const byImport = Map.groupBy(rounds, (round) => round.importId);
  return Object.fromEntries(
    currentRefs.flatMap(({ current, map }) => {
      const segments = getRoundSegments(byImport.get(current.id) ?? [], map.scoreA!, map.scoreB!);
      return segments ? [[map.id, segments]] : [];
    }),
  );
}

/** Failure-only fallback: validate basic statistics without decoding advanced projections. */
export async function readMatchScoreboardFallback(matchId: string) {
  return db.transaction(
    async (tx) => {
      const context = await loadStatsContext(
        tx,
        {},
        { matchIds: [matchId], includeTestMatch: true, skipLabels: true },
      );
      const refs = await loadCurrentProjectionRefs(tx, context);
      return {
        roundSegments: await loadMatchRoundSegments(tx, context.currentRefs),
        currentImports: Object.fromEntries(refs.map(({ current, map }) => [map.id, current.id])),
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
