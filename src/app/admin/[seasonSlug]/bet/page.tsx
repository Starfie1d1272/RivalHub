import { Suspense } from "react";
import { io } from "next/cache";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons,betPrograms } from "@/db/schema";
import { requireSeasonAdmin } from "@/lib/auth/session";
import { betBoard } from "@/lib/bet/data";
import { parseBetOperationsQuery } from "@/lib/bet/operations";
import { BetOperations } from "@/components/bet/BetOperations";
export default function BetAdminPage(props:{params:Promise<{seasonSlug:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  return <Suspense fallback={<p role="status">正在加载 BET 管理…</p>}><BetAdminContent {...props}/></Suspense>;
}
async function BetAdminContent({params,searchParams}:{params:Promise<{seasonSlug:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  await io();
  const {seasonSlug}=await params;const season=await db.query.seasons.findFirst({where:eq(seasons.slug,seasonSlug)});
  if(!season || season.competitionTemplate!=="major")notFound();await requireSeasonAdmin(season.id);
  const data=await db.transaction(tx=>betBoard(tx,season.id,null),{accessMode:"read only",isolationLevel:"repeatable read"});
  const program=await db.query.betPrograms.findFirst({where:eq(betPrograms.seasonId,season.id)});
  return <BetOperations data={data} slug={seasonSlug} pending={program?.dirty??false} query={parseBetOperationsQuery(await searchParams)}/>;
}
