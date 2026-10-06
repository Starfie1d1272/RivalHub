import { io } from "next/cache";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { PageLayout } from "@/components/rivalhub";
import { db } from "@/db/client";
import { getPublicOrAuthorizedDraftSeason } from "@/lib/data/public-seasons";
import { getUserSession } from "@/lib/auth/session";
import { betBoard } from "@/lib/bet/data";
import { BetBoard } from "@/components/bet/BetBoard";
export default function BetPage(props:{params:Promise<{seasonSlug:string}>;searchParams:Promise<{view?:string;match?:string}>}) {
  return <Suspense fallback={<PageLayout variant="wide"><p role="status">正在加载 BET…</p></PageLayout>}><BetContent {...props}/></Suspense>;
}
async function BetContent({params,searchParams}:{params:Promise<{seasonSlug:string}>;searchParams:Promise<{view?:string;match?:string}>}) {
  await io();
  const {seasonSlug}=await params;const season=await getPublicOrAuthorizedDraftSeason(seasonSlug);
  if(!season || season.competitionTemplate!=="major")notFound();
  const user=await getUserSession();const query=await searchParams;
  const data=await db.transaction(tx=>betBoard(tx,season.id,user?.userId??null),{accessMode:"read only",isolationLevel:"repeatable read"});
  return <PageLayout variant={query.match ? "standard" : "wide"}><BetBoard initial={data} slug={seasonSlug} signedIn={!!user} view={query.view??"open"} matchFilter={query.match??null}/></PageLayout>;
}
