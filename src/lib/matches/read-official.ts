import "server-only";
import { and, type SQL } from "drizzle-orm";
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
