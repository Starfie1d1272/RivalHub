import { gt } from "drizzle-orm";
import { db } from "@/db/client";
import { matchVetoInvalidations } from "@/db/schema";
import { deliverVetoInvalidation } from "@/lib/matches/veto-room/invalidation";

/** Workers retain fixtures from earlier specs. A scheduler pass drains only 50
 * rows, so establish cache quiescence via the actual delivery owner before a
 * test asserts the independent global lifecycle due signal. No reset/ack bypass.
 */
export async function deliverExistingFixtureVetoInvalidations() {
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
