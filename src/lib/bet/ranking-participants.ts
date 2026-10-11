import "server-only";
import { eq, sql } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { betAccounts, betLedger } from "@/db/schema";
/** Joined participants include unjudged accounts; qualification/ranks remain readBetAccounts-owned. */
export async function readBetRankingParticipants(tx: TxDb, seasonId: string) {
  return tx.select({userId:betAccounts.userId,profit:sql<string>`coalesce(sum(${betLedger.profit}),0)::text`})
    .from(betAccounts).leftJoin(betLedger,eq(betLedger.accountId,betAccounts.id))
    .where(eq(betAccounts.seasonId,seasonId)).groupBy(betAccounts.userId);
}
