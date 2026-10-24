import { getPublicPlayerIdentityIds } from "@/lib/players/public-identity";
import "server-only";
import { and, eq, asc, desc, sql, ne } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { betAccounts, betLedger, betSettlements, betMarkets, betStakes, users, steamProfiles } from "@/db/schema";
import { getPublicDisplayName } from "@/lib/identity/display-name";
import { marketPresentation } from "./presentation";
import { betLedgerLabel } from "./ledger-presentation";
import type { BetFacts } from "./facts";
import type { BetBoardDTO } from "./types";
export interface BetAccountReadOptions {
  leaderboard?: boolean;
  financialPopulation?: readonly {accountId:string;userId:string;balance:string;profit:string;settledCount:number|null;rank:number|null}[];
  records?: false | {page:number;size:number;cursor?:{at:string;id:string}};
}
export async function readBetAccounts(tx: TxDb, seasonId: string, accountId: string | undefined, facts: BetFacts, options: BetAccountReadOptions = {}) {
  const latest = tx.selectDistinctOn([betSettlements.marketId], { id: betSettlements.id, marketId: betSettlements.marketId, state: betSettlements.state })
    .from(betSettlements).innerJoin(betMarkets, eq(betMarkets.id, betSettlements.marketId))
    .where(eq(betMarkets.seasonId, seasonId)).orderBy(asc(betSettlements.marketId), desc(betSettlements.revision)).as("latest_bet_results");
  // Only current non-pending results qualify. Historical reversed results cannot keep an account ranked.
  const participation = tx.select({ accountId: betLedger.accountId, count: sql<number>`count(distinct ${latest.marketId})::int`.as("settled_count") })
    .from(betLedger).innerJoin(latest, and(eq(betLedger.source, sql`'settlement/' || ${latest.id}::text`), ne(latest.state, "pending")))
    .where(and(eq(betLedger.seasonId, seasonId), eq(betLedger.kind, "settlement"))).groupBy(betLedger.accountId).as("bet_participation");
  const totals = tx.select({ accountId: betLedger.accountId, balance: sql<string>`sum(${betLedger.amount})::text`.as("balance"), profit: sql<string>`sum(${betLedger.profit})::text`.as("profit") })
    .from(betLedger).where(eq(betLedger.seasonId, seasonId)).groupBy(betLedger.accountId).as("bet_totals");
  const ranked = tx.select({accountId:betAccounts.id,userId:betAccounts.userId,joinedAt:betAccounts.joinedAt,balance:sql<string>`coalesce(${totals.balance},'0')`.as("balance"),profit:sql<string>`coalesce(${totals.profit},'0')`.as("profit"),settledCount:participation.count,
    rank:sql<number | null>`case when ${participation.count} > 0 then rank() over (
      order by case when ${participation.count} > 0 then ${totals.profit}::numeric end desc nulls last
    )::int else null end`.as("account_rank")})
    .from(betAccounts).leftJoin(totals,eq(totals.accountId,betAccounts.id))
    .leftJoin(participation,eq(participation.accountId,betAccounts.id))
    .where(eq(betAccounts.seasonId,seasonId)).as("ranked_accounts");
  const summary = options.leaderboard === false && accountId
    ? options.financialPopulation ? options.financialPopulation.find(row=>row.accountId===accountId)
      : (await tx.select().from(ranked).where(eq(ranked.accountId,accountId)))[0] : undefined;
  const rows = options.leaderboard === false ? [] : await tx.select({ accountId: ranked.accountId, userId: users.id, displayName: users.displayName, personaName: steamProfiles.personaName, perfectName: users.perfectName,
    balance: ranked.balance, profit: ranked.profit, settledCount: ranked.settledCount, rank:ranked.rank })
    .from(ranked).innerJoin(users, eq(users.id, ranked.userId)).leftJoin(steamProfiles, eq(steamProfiles.steam64, users.steam64))
    .orderBy(sql`${ranked.profit}::numeric desc`, desc(ranked.settledCount), asc(ranked.joinedAt), asc(ranked.accountId));
  const mine = rows.find(row => row.accountId === accountId);
  const eligible = rows.filter(row => (row.settledCount ?? 0) > 0);
  const playerIds = await getPublicPlayerIdentityIds(tx, eligible.map(row => row.userId));
  const leaderboard: BetBoardDTO["leaderboard"] = eligible.map(row => {
    return { userId: row.userId, playerUserId: playerIds.has(row.userId) ? row.userId : null, name: getPublicDisplayName(row), profit: row.profit, settledCount: row.settledCount!, rank:row.rank! };
  });
  // Only the authenticated viewer's account is read; raw source keys never leave this owner.
  const ledgerRows = accountId && options.records !== false ? await tx.select({ id:betLedger.id, cursorAt:sql<string>`${betLedger.createdAt}::text`, createdAt: betLedger.createdAt, amount: betLedger.amount, kind: betLedger.kind, source: betLedger.source,
    state: betSettlements.state, market: betMarkets })
    .from(betLedger)
    .leftJoin(betStakes, and(eq(betLedger.kind, "stake"), eq(betStakes.accountId, betLedger.accountId), eq(betLedger.source, sql`'stake/' || ${betStakes.id}::text`)))
    .leftJoin(betSettlements, and(sql`${betLedger.kind} in ('settlement', 'reversal')`, eq(sql`split_part(${betLedger.source}, '/', 2)`, sql`${betSettlements.id}::text`)))
    .leftJoin(betMarkets, and(eq(betMarkets.seasonId, seasonId), eq(betMarkets.id, sql`coalesce(${betStakes.marketId}, ${betSettlements.marketId})`)))
    .where(and(eq(betLedger.accountId, accountId), eq(betLedger.seasonId, seasonId),options.records && options.records.cursor ? sql`(${betLedger.createdAt},${betLedger.id}) < (${options.records.cursor.at}::timestamptz,${options.records.cursor.id}::uuid)` : undefined))
    .orderBy(desc(betLedger.createdAt), desc(betLedger.id))
    .limit(options.records ? options.records.size + 1 : 2147483647)
    .offset(options.records && !options.records.cursor ? options.records.page * options.records.size : 0) : [];
  const recordsHasMore = !!options.records && ledgerRows.length > options.records.size;
  const last=options.records ? ledgerRows[Math.min(ledgerRows.length,options.records.size)-1] : undefined;
  const recordsNextCursor=recordsHasMore && last ? Buffer.from(JSON.stringify({at:last.cursorAt,id:last.id})).toString("base64url") : undefined;
  const records: BetBoardDTO["records"] = (options.records ? ledgerRows.slice(0,options.records.size) : ledgerRows).map(row => {
    const stage = row.kind === "stage" ? facts.season.stagePlan.find(stage => row.source === `stage/${stage.key}`)?.name ?? "正赛阶段" : null;
    const label = betLedgerLabel(row.kind, stage, row.state);
    const market = row.market;
    const context = market ? [market.subject.kind === "event" ? "赛事" : market.subject.entryIds.map(id => facts.entries.find(entry => entry.id === id)?.name ?? "队伍").join(" vs "),
      marketPresentation(market.type, market.line).title, market.subject.kind === "map" || market.subject.kind === "map_slot" ? `第${market.subject.mapOrder}图` : null].filter(Boolean).join(" · ") : null;
    return { createdAt: row.createdAt.toISOString(), amount: row.amount.toString(), label, context };
  });
  return { balance: BigInt(summary?.balance ?? mine?.balance ?? "0"), profit: summary?.profit ?? mine?.profit ?? "0", rank: summary?.rank ?? leaderboard.find(row => row.userId === mine?.userId)?.rank ?? null, leaderboard, records, recordsHasMore, recordsNextCursor,financialPopulation:rows };
}
