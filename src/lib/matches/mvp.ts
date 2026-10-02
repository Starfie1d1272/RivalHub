import "server-only";

import { and, asc, desc, eq, exists, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { db, type DB, type TxDb } from "@/db/client";
import { matchMvpVotes, matches, seasons } from "@/db/schema";
import { writeAuditInTx } from "@/lib/audit/write";
import { MVP_DEADLINE_MS } from "@/lib/utils/date";

/** A renamed player remains one candidate. Legacy unbound votes retain names. */
export function readMatchMvpResults(matchId: string, database: Pick<TxDb, "select"> = db) {
  return database
    .select({
      playerUserId: matchMvpVotes.playerUserId,
      playerName: sql<string>`min(${matchMvpVotes.playerName})`,
      count: sql<number>`count(*)::int`,
    })
    .from(matchMvpVotes)
    .where(eq(matchMvpVotes.matchId, matchId))
    .groupBy(
      matchMvpVotes.playerUserId,
      sql`case when ${matchMvpVotes.playerUserId} is null then ${matchMvpVotes.playerName} end`,
    )
    .orderBy(desc(sql`count(*)`), asc(sql`min(${matchMvpVotes.createdAt})`), asc(matchMvpVotes.playerUserId));
}

/** The scheduler owns settlement; public reads never materialize winner facts. */
export async function settleExpiredMatchMvpVotes(now = new Date(), database: DB = db) {
  const cutoff = new Date(now.getTime() - MVP_DEADLINE_MS);
  const candidates = await database
    .select({ matchId: matches.id, seasonSlug: seasons.slug })
    .from(matches)
    .innerJoin(seasons, eq(seasons.id, matches.seasonId))
    .where(and(
      eq(matches.status, "finished"),
      isNull(matches.mvpWinnerUserId),
      lte(matches.completedAt, cutoff),
      exists(database.select({ id: matchMvpVotes.id }).from(matchMvpVotes).where(and(
        eq(matchMvpVotes.matchId, matches.id),
        isNotNull(matchMvpVotes.playerUserId),
      ))),
    ))
    .orderBy(asc(matches.completedAt), asc(matches.id))
    .limit(100);

  const affectedMatches: Array<{ matchId: string; seasonSlug: string }> = [];
  const failures: unknown[] = [];
  for (const candidate of candidates) {
    try {
      const settled = await database.transaction(async (tx) => {
        const [match] = await tx.select({
          id: matches.id,
          seasonId: matches.seasonId,
          completedAt: matches.completedAt,
          status: matches.status,
          winner: matches.mvpWinnerUserId,
        }).from(matches).where(eq(matches.id, candidate.matchId)).for("update", { skipLocked: true });
        if (!match || match.status !== "finished" || match.winner || !match.completedAt
          || match.completedAt.getTime() > cutoff.getTime()) return false;

        const results = await readMatchMvpResults(match.id, tx);
        const winner = results.find((result) => result.playerUserId !== null);
        if (!winner?.playerUserId) return false;

        await tx.update(matches).set({ mvpWinnerUserId: winner.playerUserId, updatedAt: now })
          .where(eq(matches.id, match.id));
        await writeAuditInTx(tx, {
          action: "match.mvp.settle",
          actorId: "system",
          targetId: match.id,
          seasonId: match.seasonId,
          meta: { winnerUserId: winner.playerUserId, votes: winner.count },
        });
        return true;
      });
      if (settled) affectedMatches.push(candidate);
    } catch (error) {
      failures.push(error);
    }
  }
  return { processed: candidates.length, settled: affectedMatches.length, affectedMatches, failures };
}
