import { traceOperation } from "@/lib/observability/server";
import { io } from "next/cache";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { PageLayout } from "@/components/rivalhub";
import { db } from "@/db/client";
import { getPublicOrAuthorizedDraftSeason } from "@/lib/data/public-seasons";
import { getUserSession } from "@/lib/auth/session";
import { getBetPublicStats } from "@/lib/bet/public-stats-cache";
import { readUnifiedBetSnapshot, projectUnifiedBetBoard } from "@/lib/bet/board-read";
import { z } from "zod";
import { UnifiedBetBoard } from "@/components/bet/UnifiedBetBoard";
import { freeRankingModel } from "@/components/bet/free-prediction-presentation";
import { readBetRelief } from "@/lib/bet/relief-data";
import { readFreeRankingSnapshot, projectFreeRankings } from "@/lib/free-predictions/ranking";
export default function BetPage(props:{params:Promise<{seasonSlug:string}>;searchParams:Promise<{view?:string;match?:string;market?:string;option?:string;prediction?:string;choice?:string;page?:string;cursor?:string}>}) {
  return <Suspense fallback={<PageLayout variant="wide"><p role="status">正在加载 BET…</p></PageLayout>}><BetContent {...props}/></Suspense>;
}
async function BetContent({params,searchParams}:{params:Promise<{seasonSlug:string}>;searchParams:Promise<{view?:string;match?:string;market?:string;option?:string;prediction?:string;choice?:string;page?:string;cursor?:string}>}) {
  await io();
  const {seasonSlug}=await params;const season=await getPublicOrAuthorizedDraftSeason(seasonSlug);
  if(!season || season.competitionTemplate!=="major")notFound();
  const user=await getUserSession();const query=await searchParams;
  const view=["open","mine","settled","event","leaderboard","records"].includes(query.view??"")?query.view!:"open";
  const matchId=query.match ? z.guid().safeParse(query.match) : null;
  if(matchId && !matchId.success)notFound();
  const recordsPage=/^\d{1,6}$/.test(query.page??"")?Number(query.page):0;
  const scope={view,matchId:matchId?.data,recordsPage,recordsCursor:query.cursor};
  const publicStats=await getBetPublicStats(season,scope);
  const data=await traceOperation("bet.page.transaction",{scope:"bet",operation:"page",stage:"transaction"},()=>db.transaction(async tx=>{
    const rankings=query.view==="leaderboard"?await readFreeRankingSnapshot(tx,season.id):undefined;
    const board=await readUnifiedBetSnapshot(tx,season.id,user?.userId??null,scope,publicStats,
      rankings?{facts:rankings.facts,financialPopulation:rankings.finances.financialPopulation}:undefined);
    const relief=await readBetRelief(tx,season.id,user?.userId??null);
    return {board,rankings,relief};
  },{accessMode:"read only",isolationLevel:"repeatable read"}));
  const {board,rankings}=await traceOperation("bet.page.project",{scope:"bet",operation:"page",stage:"project"},async()=>{
  const board=projectUnifiedBetBoard(data.board);
  const rankingData=data.rankings?projectFreeRankings(data.rankings):undefined;
  const rankings=rankingData?{profit:freeRankingModel(rankingData.profit),hits:freeRankingModel(rankingData.hits),accuracy:freeRankingModel(rankingData.accuracy)}:undefined;
    return {board,rankings};
  });
  return <PageLayout variant={query.match ? "standard" : "wide"}><UnifiedBetBoard initial={board.bet} freeMatches={board.free.matches} reliefModel={data.relief} rankings={rankings} slug={seasonSlug} signedIn={!!user} view={view} recordsPage={recordsPage} matchFilter={query.match??null} returnSelection={{market:query.market,option:query.option,prediction:query.prediction,choice:query.choice}}/></PageLayout>;
}
