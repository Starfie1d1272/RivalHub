import { gt, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { matches, matchVetoInvalidations } from "@/db/schema";
import { deliverVetoInvalidation } from "@/lib/matches/veto-room/invalidation";

/** Workers retain fixtures from earlier specs. A scheduler pass drains only 50
 * rows, so establish cache quiescence via the actual delivery owner before a
 * test asserts the independent global lifecycle due signal. No reset/ack bypass.
 */
export async function deliverExistingFixtureVetoInvalidations() {
  // Some existing fixture teardowns disable triggers with replica mode. Restore
  // only the ON DELETE CASCADE they skipped for actually deleted parents.
  // Never erase an obligation whose authoritative match still exists.
  await db.delete(matchVetoInvalidations).where(sql`NOT EXISTS (
    SELECT 1 FROM ${matches} WHERE ${matches.id}=${matchVetoInvalidations.matchId}
  )`);
  const pending = await db.select({ matchId: matchVetoInvalidations.matchId }).from(matchVetoInvalidations)
    .where(gt(matchVetoInvalidations.generation, matchVetoInvalidations.publishedGeneration));
  for (const row of pending) {
    if (await deliverVetoInvalidation(row.matchId, "route") !== "complete") {
      throw new Error("Fixture cache generation changed during delivery; lifecycle test is not isolated");
    }
  }
  const [remaining] = await db.select({ matchId: matchVetoInvalidations.matchId }).from(matchVetoInvalidations)
    .where(gt(matchVetoInvalidations.generation, matchVetoInvalidations.publishedGeneration)).limit(1);
  if (remaining) throw new Error("Fixture cache delivery remained pending");
}
