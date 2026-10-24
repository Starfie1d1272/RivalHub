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
  // One statement holds the same snapshot and clock while avoiding per-fact round trips.
  const currentDay = sql<string>`relief_clock.day`;
  const totals = tx.select({
    balance: sql<string>`coalesce(sum(${betLedger.amount}), 0)::text`.as("balance"),
    granted: sql<string>`coalesce(sum(${betLedger.amount}) filter (where ${betLedger.kind} = 'relief'), 0)::text`.as("granted"),
    claimedToday: sql<boolean>`coalesce(bool_or(${betLedger.kind} = 'relief' and ${betLedger.source} = 'relief/' || ${currentDay}), false)`.as("claimed_today"),
  }).from(betLedger).where(and(eq(betLedger.accountId, betAccounts.id), eq(betLedger.seasonId, seasonId))).as("relief_totals");
  const [facts] = await tx.select({
    day: currentDay, seasonStatus: seasons.status, template: seasons.competitionTemplate,
    programId: betPrograms.seasonId, paused: betPrograms.paused, userStatus: users.status, verifiedAt: users.emailVerifiedAt,
    accountId: betAccounts.id, balance: totals.balance, granted: totals.granted, claimedToday: totals.claimedToday,
  }).from(sql`(select coalesce(${day ?? null}::text, to_char(clock_timestamp() at time zone 'Asia/Shanghai', 'YYYY-MM-DD')) as day) as relief_clock`)
    .leftJoin(seasons, eq(seasons.id, seasonId))
    .leftJoin(betPrograms, eq(betPrograms.seasonId, seasonId))
    .leftJoin(users, sql`${users.id} = ${userId}`)
    .leftJoin(betAccounts, and(eq(betAccounts.seasonId, seasonId), eq(betAccounts.userId, users.id)))
    .leftJoinLateral(totals, sql`true`);
  const eligibility = projectBetRelief({day: facts!.day, loggedIn: !!userId, activeVerified: facts!.userStatus === "active" && !!facts!.verifiedAt,
    enabled: !!facts!.programId, paused: facts!.paused ?? false, seasonOpen: facts!.template === "major" && !["finished", "archived"].includes(facts!.seasonStatus ?? ""),
    joined: !!facts!.accountId, balance: BigInt(facts!.balance ?? "0"), granted: BigInt(facts!.granted ?? "0"), claimedToday: facts!.claimedToday ?? false});
  return canPublishBetRelief() ? eligibility : { ...eligibility, canClaim: false, amount: "0", reason: "publication_unavailable" };
}
