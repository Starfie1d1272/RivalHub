import "server-only";
import { and, eq, gt } from "drizzle-orm";
import { db, type DB } from "@/db/client";
import { matchVetoInvalidations, matches, seasons } from "@/db/schema";
import { revalidateVetoRoomPaths } from "@/lib/revalidation";

/** BP-specific postcommit delivery. Never replays a domain command. */
export async function deliverVetoInvalidation(matchId: string, mode: "action" | "route", database: DB = db): Promise<"complete" | "pending"> {
  const [pending] = await database.select({ generation: matchVetoInvalidations.generation, affectedFacts: matchVetoInvalidations.affectedFacts, slug: seasons.slug, seasonId: seasons.id, matchStatus: matches.status })
    .from(matchVetoInvalidations)
    .innerJoin(matches, eq(matches.id, matchVetoInvalidations.matchId))
    .innerJoin(seasons, eq(seasons.id, matches.seasonId))
    .where(and(eq(matchVetoInvalidations.matchId, matchId), gt(matchVetoInvalidations.generation, matchVetoInvalidations.publishedGeneration)))
    .limit(1);
  if (!pending) return "complete";
  // All existing hard-expire dependencies, including correction/withdrawal,
  // remain owned by revalidation. A thrown call leaves the watermark pending.
  revalidateVetoRoomPaths({ slug: pending.slug, seasonId: pending.seasonId, matchId, matchStatus: pending.matchStatus },
    { changed: true, affectedFacts: pending.affectedFacts }, { mode });
  const acknowledged = await database.update(matchVetoInvalidations)
    .set({ publishedGeneration: pending.generation })
    .where(and(eq(matchVetoInvalidations.matchId, matchId), eq(matchVetoInvalidations.generation, pending.generation)))
    .returning({ matchId: matchVetoInvalidations.matchId });
  // A fact committed during invalidation gets a newer generation. CAS must not
  // acknowledge it; an authorized reconcile or the scheduler will deliver it.
  return acknowledged.length ? "complete" : "pending";
}
