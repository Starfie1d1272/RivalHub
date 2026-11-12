import { gt, sql } from "drizzle-orm";
import { vi } from "vitest";
import { db, type DB } from "@/db/client";
import { matches, matchVetoInvalidations } from "@/db/schema";
import { deliverMatchProjectionInvalidations } from "@/lib/matches/projection-invalidation/delivery";

const acknowledgements = vi.hoisted(() => [] as Array<(confirmed: boolean) => Promise<void>>);
vi.mock("@/lib/matches/projection-invalidation/next-adapter", async (original) => ({
  ...await original<typeof import("@/lib/matches/projection-invalidation/next-adapter")>(),
  observeHardExpiry: async (_tags: string[], settle: (confirmed: boolean) => Promise<void>) => {
    acknowledgements.push(settle);
  },
}));

export async function flushProjectionAcknowledgements(confirmed = true) {
  for (const settle of acknowledgements.splice(0)) await settle(confirmed);
}

export async function deliverFixtureInvalidation(matchId: string, database?: DB) {
  await deliverMatchProjectionInvalidations("route", [matchId], database);
  await flushProjectionAcknowledgements();
}

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
  await deliverMatchProjectionInvalidations("route", pending.map(({ matchId }) => matchId));
  await flushProjectionAcknowledgements();
  const [remaining] = await db.select({ matchId: matchVetoInvalidations.matchId }).from(matchVetoInvalidations)
    .where(gt(matchVetoInvalidations.generation, matchVetoInvalidations.publishedGeneration)).limit(1);
  if (remaining) throw new Error("Fixture cache delivery remained pending");
}
