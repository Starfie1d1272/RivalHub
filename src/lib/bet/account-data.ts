import { getPublicPlayerIdentityIds } from "@/lib/players/public-identity";
import "server-only";
import { and, eq, asc, desc, sql, ne } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { betAccounts, betLedger, betSettlements, betMarkets, betStakes, users, steamProfiles } from "@/db/schema";
import { getPublicDisplayName } from "@/lib/identity/display-name";
import { marketPresentation } from "./presentation";
import type { BetFacts } from "./facts";
import type { BetBoardDTO } from "./types";
export async function readBetAccounts(tx: TxDb, seasonId: string, accountId: string | undefined, facts: BetFacts) {
  const latest = tx.selectDistinctOn([betSettlements.marketId], { id: betSettlements.id, marketId: betSettlements.marketId, state: betSettlements.state })
    .from(betSettlements).innerJoin(betMarkets, eq(betMarkets.id, betSettlements.marketId))
    .where(eq(betMarkets.seasonId, seasonId)).orderBy(asc(betSettlements.marketId), desc(betSettlements.revision)).as("latest_bet_results");
  // Only current non-pending results qualify. Historical reversed results cannot keep an account ranked.
  const participation = tx.select({ accountId: betLedger.accountId, count: sql<number>`count(distinct ${latest.marketId})::int`.as("settled_count") })
    .from(betLedger).innerJoin(latest, and(eq(betLedger.source, sql`'settlement/' || ${latest.id}::text`), ne(latest.state, "pending")))
    .where(and(eq(betLedger.seasonId, seasonId), eq(betLedger.kind, "settlement"))).groupBy(betLedger.accountId).as("bet_participation");
  const totals = tx.select({ accountId: betLedger.accountId, balance: sql<string>`sum(${betLedger.amount})::text`.as("balance"), profit: sql<string>`sum(${betLedger.profit})::text`.as("profit") })
    .from(betLedger).where(eq(betLedger.seasonId, seasonId)).groupBy(betLedger.accountId).as("bet_totals");
  const rows = await tx.select({ accountId: betAccounts.id, userId: users.id, displayName: users.displayName, personaName: steamProfiles.personaName, perfectName: users.perfectName,
    joinedAt: betAccounts.joinedAt, balance: totals.balance, profit: totals.profit, settledCount: participation.count })
    .from(betAccounts).innerJoin(users, eq(users.id, betAccounts.userId)).leftJoin(steamProfiles, eq(steamProfiles.steam64, users.steam64))
    .innerJoin(totals, eq(totals.accountId, betAccounts.id)).leftJoin(participation, eq(participation.accountId, betAccounts.id))
    .where(eq(betAccounts.seasonId, seasonId))
    .orderBy(sql`${totals.profit}::numeric desc`, desc(participation.count), asc(betAccounts.joinedAt), asc(betAccounts.id));
  const mine = rows.find(row => row.accountId === accountId);
  const eligible = rows.filter(row => (row.settledCount ?? 0) > 0);
  let rank = 0;
  const playerIds = await getPublicPlayerIdentityIds(tx, eligible.map(row => row.userId));
  const leaderboard: BetBoardDTO["leaderboard"] = eligible.map((row, index) => {
    if (index === 0 || row.profit !== eligible[index - 1]!.profit) rank = index + 1;
    return { userId: row.userId, playerUserId: playerIds.has(row.userId) ? row.userId : null, name: getPublicDisplayName(row), profit: row.profit, settledCount: row.settledCount!, rank };
  });
  // Only the authenticated viewer's account is read; raw source keys never leave this owner.
  const ledgerRows = accountId ? await tx.select({ createdAt: betLedger.createdAt, amount: betLedger.amount, kind: betLedger.kind, source: betLedger.source,
    state: betSettlements.state, market: betMarkets })
    .from(betLedger)
    .leftJoin(betStakes, and(eq(betLedger.kind, "stake"), eq(betStakes.accountId, betLedger.accountId), eq(betLedger.source, sql`'stake/' || ${betStakes.id}::text`)))
    .leftJoin(betSettlements, and(sql`${betLedger.kind} in ('settlement', 'reversal')`, eq(sql`split_part(${betLedger.source}, '/', 2)`, sql`${betSettlements.id}::text`)))
    .leftJoin(betMarkets, and(eq(betMarkets.seasonId, seasonId), eq(betMarkets.id, sql`coalesce(${betStakes.marketId}, ${betSettlements.marketId})`)))
    .where(and(eq(betLedger.accountId, accountId), eq(betLedger.seasonId, seasonId)))
    .orderBy(desc(betLedger.createdAt), desc(betLedger.id)) : [];
  const records: BetBoardDTO["records"] = ledgerRows.map(row => {
    const stage = row.kind === "stage" ? facts.season.stagePlan.find(stage => row.source === `stage/${stage.key}`)?.name ?? "正赛阶段" : null;
    const label = row.kind === "initial" ? "初始积分" : row.kind === "stage" ? `${stage} 补给` : row.kind === "stake" ? "投入"
      : row.kind === "reversal" ? "官方赛果更正，撤销原结算" : row.state === "refunded" ? "退款：盘口作废或奖池不满足分配条件" : "结算";
    const market = row.market;
    const context = market ? [market.subject.kind === "event" ? "赛事" : market.subject.entryIds.map(id => facts.entries.find(entry => entry.id === id)?.name ?? "队伍").join(" vs "),
      marketPresentation(market.type, market.line).title, market.subject.kind === "map" ? `图 ${market.subject.mapOrder}` : null].filter(Boolean).join(" · ") : null;
    return { createdAt: row.createdAt.toISOString(), amount: row.amount.toString(), label, context };
  });
  return { balance: BigInt(mine?.balance ?? "0"), profit: mine?.profit ?? "0", rank: leaderboard.find(row => row.userId === mine?.userId)?.rank ?? null, leaderboard, records };
}
