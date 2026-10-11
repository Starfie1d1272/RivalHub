import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { betAccounts, betLedger, betPrograms, seasons, users } from "@/db/schema";
import { projectBetRelief, type BetReliefDTO } from "./relief";
import { canPublishBetRelief } from "./ledger-publication";
/** Call after the program lock for writes: transaction-start time can precede midnight. */
export async function betReliefDay(tx: TxDb): Promise<string> {
  const result = await tx.execute(sql`select to_char(clock_timestamp() at time zone 'Asia/Shanghai', 'YYYY-MM-DD') as day`);
  return String(result.rows[0]!.day);
}
/** Pure reads, including for unjoined viewers: never opens an account or reconciles. */
export async function readBetRelief(tx: TxDb, seasonId: string, userId: string | null, day?: string): Promise<BetReliefDTO> {
  const currentDay = day ?? await betReliefDay(tx);
  const season = await tx.query.seasons.findFirst({where: eq(seasons.id, seasonId), columns: {status: true, competitionTemplate: true}});
  const program = await tx.query.betPrograms.findFirst({where: eq(betPrograms.seasonId, seasonId)});
  const user = userId ? await tx.query.users.findFirst({where: eq(users.id, userId), columns: {status: true, emailVerifiedAt: true}}) : undefined;
  const account = userId ? await tx.query.betAccounts.findFirst({where: and(eq(betAccounts.seasonId, seasonId), eq(betAccounts.userId, userId))}) : undefined;
  const [totals] = account ? await tx.select({
    balance: sql<string>`coalesce(sum(${betLedger.amount}), 0)::text`,
    granted: sql<string>`coalesce(sum(${betLedger.amount}) filter (where ${betLedger.kind} = 'relief'), 0)::text`,
    claimedToday: sql<boolean>`coalesce(bool_or(${betLedger.kind} = 'relief' and ${betLedger.source} = ${`relief/${currentDay}`}), false)`,
  }).from(betLedger).where(and(eq(betLedger.accountId, account.id), eq(betLedger.seasonId, seasonId))) : [];
  const eligibility = projectBetRelief({day: currentDay, loggedIn: !!userId, activeVerified: !!user && user.status === "active" && !!user.emailVerifiedAt,
    enabled: !!program, paused: program?.paused ?? false, seasonOpen: !!season && season.competitionTemplate === "major" && !["finished", "archived"].includes(season.status),
    joined: !!account, balance: BigInt(totals?.balance ?? "0"), granted: BigInt(totals?.granted ?? "0"), claimedToday: totals?.claimedToday ?? false});
  return canPublishBetRelief() ? eligibility : { ...eligibility, canClaim: false, amount: "0", reason: "publication_unavailable" };
}
