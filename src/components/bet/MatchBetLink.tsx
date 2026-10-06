import Link from "next/link";
import { and,eq,sql } from "drizzle-orm";
import { db } from "@/db/client";
import { betMarkets,betStakes } from "@/db/schema";
import { formatPoints } from "@/lib/bet/presentation";
export async function MatchBetLink({seasonId,matchId,slug}:{seasonId:string;matchId:string;slug:string}) {
  const [market]=await db.select({id:betMarkets.id}).from(betMarkets).where(and(eq(betMarkets.seasonId,seasonId),eq(betMarkets.matchId,matchId),eq(betMarkets.type,"match_winner"))).limit(1);
  if(!market)return null;
  const [pool]=await db.select({amount:sql<string>`coalesce(sum(${betStakes.amount}),0)::text`}).from(betStakes).where(eq(betStakes.marketId,market.id));
  return <Link href={`/${slug}/bet?match=${matchId}` as never} className="flex flex-wrap items-center justify-between gap-3 border border-[var(--color-border)] bg-[var(--color-panel-low)] p-4 text-sm focus-visible:outline focus-visible:outline-[var(--color-accent)]"><span className="flex gap-3"><b className="font-mono text-[var(--color-accent)]">BET</b><span className="text-[var(--color-fg-mid)]">比赛胜者 · 奖池 {formatPoints(pool?.amount??"0")}</span></span><span>查看盘口 →</span></Link>;
}
