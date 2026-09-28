import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { predictionAccounts, predictionMarketOptions, predictionMarkets, predictionPrograms, predictionStakes } from "@/db/schema";
import { effectivePredictionMarketDeadline } from "@/lib/predictions/rules";

export async function loadMatchPrediction(matchId: string, seasonId: string, scheduledAt: Date | null, userId: string | null) {
  const [market] = await db.select({ market: predictionMarkets, rules: predictionPrograms.rules, paused: predictionPrograms.paused })
    .from(predictionMarkets).innerJoin(predictionPrograms, eq(predictionPrograms.seasonId, predictionMarkets.seasonId))
    .where(and(eq(predictionMarkets.matchId, matchId), eq(predictionMarkets.seasonId, seasonId), eq(predictionMarkets.resolver, "match_winner")));
  if (!market) return null;
  const [options, totals, [participant], [mine]] = await Promise.all([
    db.select({ id: predictionMarketOptions.id, entryId: predictionMarketOptions.entryId }).from(predictionMarketOptions).where(eq(predictionMarketOptions.marketId, market.market.id)).orderBy(predictionMarketOptions.position),
    db.select({ optionId: predictionStakes.optionId, amount: sql<string>`sum(${predictionStakes.amount})::text` }).from(predictionStakes).where(eq(predictionStakes.marketId, market.market.id)).groupBy(predictionStakes.optionId),
    db.select({ count: sql<number>`count(distinct ${predictionStakes.accountId})::int` }).from(predictionStakes).where(eq(predictionStakes.marketId, market.market.id)),
    userId ? db.select({ amount: sql<string>`coalesce(sum(${predictionStakes.amount}), 0)::text` }).from(predictionStakes).innerJoin(predictionAccounts, eq(predictionAccounts.id, predictionStakes.accountId)).where(and(eq(predictionStakes.marketId, market.market.id), eq(predictionAccounts.userId, userId))) : Promise.resolve([]),
  ]);
  const amount = (id: string) => BigInt(totals.find(row => row.optionId === id)?.amount ?? "0");
  const shares = options.map(option => ({ entryId: option.entryId, amount: amount(option.id) }));
  const total = shares.reduce((sum, row) => sum + row.amount, BigInt(0));
  const deadline = effectivePredictionMarketDeadline({ marketDeadline: market.market.deadline, scheduledAt, cutoffMinutes: market.rules.cutoffMinutes });
  return {
    shares: shares.map(row => ({ entryId: row.entryId, percent: total > BigInt(0) ? Number(row.amount * BigInt(1000) / total) / 10 : null })),
    participants: participant?.count ?? 0,
    deadline: deadline.toISOString(),
    closed: market.paused || market.market.lockedAt !== null || deadline.getTime() <= Date.now(),
    myStake: mine?.amount ?? null,
  };
}
