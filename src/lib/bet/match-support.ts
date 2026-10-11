import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { betMarkets, betOptions, betStakes } from "@/db/schema";

/** Public, read-only stake totals; option keys retain the frozen team identity. */
export async function readMatchSupport(db: DB, seasonId: string, matchId: string) {
  const [market] = await db.select({ id: betMarkets.id })
    .from(betMarkets)
    .where(and(eq(betMarkets.seasonId, seasonId), eq(betMarkets.matchId, matchId), eq(betMarkets.type, "match_winner")))
    .orderBy(desc(betMarkets.createdAt)).limit(1);
  if (!market) return null;

  return db.select({ entryId: betOptions.key, amount: sql<string>`coalesce(sum(${betStakes.amount}),0)::text` })
    .from(betOptions)
    .leftJoin(betStakes, eq(betStakes.optionId, betOptions.id))
    .where(eq(betOptions.marketId, market.id))
    .groupBy(betOptions.key);
}
