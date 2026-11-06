import "server-only";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { matchVetoInvalidations } from "@/db/schema";
import { deliverMatchProjectionInvalidation } from "./delivery";

/** Attempt a bounded oldest-first batch; rotate failures without losing newer generations. */
export async function dispatchMatchProjectionInvalidations() {
  const rows = await db
    .select({
      matchId: matchVetoInvalidations.matchId,
      generation: matchVetoInvalidations.generation,
    })
    .from(matchVetoInvalidations)
    .where(gt(matchVetoInvalidations.generation, matchVetoInvalidations.publishedGeneration))
    .orderBy(asc(matchVetoInvalidations.updatedAt))
    .limit(50);
  let pending = 0;
  let firstFailure: unknown;
  for (const row of rows) {
    try {
      if ((await deliverMatchProjectionInvalidation(row.matchId, "route")) === "pending")
        pending += 1;
    } catch (error) {
      firstFailure ??= error;
    }
    try {
      await db
        .update(matchVetoInvalidations)
        .set({ updatedAt: sql`clock_timestamp()` })
        .where(
          and(
            eq(matchVetoInvalidations.matchId, row.matchId),
            eq(matchVetoInvalidations.generation, row.generation),
            gt(matchVetoInvalidations.generation, matchVetoInvalidations.publishedGeneration),
          ),
        );
    } catch (error) {
      firstFailure ??= error;
    }
  }
  if (firstFailure) throw firstFailure;
  return { processed: rows.length, pending };
}
