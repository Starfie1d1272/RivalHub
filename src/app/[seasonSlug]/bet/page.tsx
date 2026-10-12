import { io } from "next/cache";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { PageLayout } from "@/components/rivalhub";
import { db } from "@/db/client";
import { getPublicOrAuthorizedDraftSeason } from "@/lib/data/public-seasons";
import { getUserSession } from "@/lib/auth/session";
import { betBoard } from "@/lib/bet/data";
import { UnifiedBetBoard } from "@/components/bet/UnifiedBetBoard";
import { freeRankingModel } from "@/components/bet/free-prediction-presentation";
import { readBetRelief } from "@/lib/bet/relief-data";
import { readFreePredictionBoard } from "@/lib/free-predictions/data";
import { readFreePredictionRanking } from "@/lib/free-predictions/ranking";
export default function BetPage(props:{params:Promise<{seasonSlug:string}>;searchParams:Promise<{view?:string;match?:string;market?:string;option?:string;prediction?:string;choice?:string}>}) {
  return <Suspense fallback={<PageLayout variant="wide"><p role="status">正在加载 BET…</p></PageLayout>}><BetContent {...props}/></Suspense>;
}
async function BetContent({params,searchParams}:{params:Promise<{seasonSlug:string}>;searchParams:Promise<{view?:string;match?:string;market?:string;option?:string;prediction?:string;choice?:string}>}) {
  await io();
  const {seasonSlug}=await params;const season=await getPublicOrAuthorizedDraftSeason(seasonSlug);
  if(!season || season.competitionTemplate!=="major")notFound();
  const user=await getUserSession();const query=await searchParams;
  const data=await db.transaction(async tx=>{
    const bet=await betBoard(tx,season.id,user?.userId??null);
    const free=await readFreePredictionBoard(tx,season.id,user?.userId??null);
    const rankings=query.view==="leaderboard"?{
      profit:freeRankingModel(await readFreePredictionRanking(tx,season.id,"profit")),
      hits:freeRankingModel(await readFreePredictionRanking(tx,season.id,"hits")),
      accuracy:freeRankingModel(await readFreePredictionRanking(tx,season.id,"accuracy")),
    }:undefined;
    const relief=await readBetRelief(tx,season.id,user?.userId??null);
    return {bet,free,rankings,relief};
  },{accessMode:"read only",isolationLevel:"repeatable read"});
  return <PageLayout variant={query.match ? "standard" : "wide"}><UnifiedBetBoard initial={data.bet} freeMatches={data.free.matches} reliefModel={data.relief} rankings={data.rankings} slug={seasonSlug} signedIn={!!user} view={query.view??"open"} matchFilter={query.match??null} returnSelection={{market:query.market,option:query.option,prediction:query.prediction,choice:query.choice}}/></PageLayout>;
}
