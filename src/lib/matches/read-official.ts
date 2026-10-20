import "server-only";
import { and, count, eq, sql, type SQL } from "drizzle-orm";
import { db, type TxDb } from "@/db/client";
import { matches } from "@/db/schema";
import { officialMatchCondition } from "./scope";

/** Default read entry for official match facts; callers cannot forget the test exclusion.
 * Joins/aggregates that must retain their own projection use officialMatchCondition().
 */
export function loadOfficialMatchRows(condition: SQL, executor: Pick<TxDb, "select"> = db) {
  return executor.select().from(matches).where(and(officialMatchCondition(), condition));
}

export function loadOfficialMatchStages(condition: SQL, executor: Pick<TxDb, "selectDistinct"> = db) {
  return executor.selectDistinct({ stage: matches.stage }).from(matches).where(and(officialMatchCondition(), condition));
}

/** Event totals are independent of the current entrant/roster directory. */
export async function getOfficialSeasonMatchSummary(seasonId: string, executor: Pick<TxDb, "select"> = db) {
  const [row] = await executor.select({
    total: count(),
    finished: sql<number>`count(*) filter (where ${matches.status} = 'finished')`,
  }).from(matches).where(and(officialMatchCondition(), eq(matches.seasonId, seasonId)));
  return { total: Number(row?.total ?? 0), finished: Number(row?.finished ?? 0) };
}
