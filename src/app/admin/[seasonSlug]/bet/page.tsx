import { Suspense } from "react";
import { io } from "next/cache";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { findAdminSeasonBySlug } from "@/lib/admin/season-context";
import { requireSeasonAdmin } from "@/lib/auth/session";
import { readBetOperationsSnapshot, projectBetBoard } from "@/lib/bet/data";
import { parseBetOperationsQuery } from "@/lib/bet/operations";
import { BetOperations } from "@/components/bet/BetOperations";
export default function BetAdminPage(props:{params:Promise<{seasonSlug:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  return <Suspense fallback={<p role="status">正在加载 BET 管理…</p>}><BetAdminContent {...props}/></Suspense>;
}
async function BetAdminContent({params,searchParams}:{params:Promise<{seasonSlug:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  await io();
  const {seasonSlug}=await params;const season=await findAdminSeasonBySlug(seasonSlug);
  if(!season || season.competitionTemplate!=="major")notFound();await requireSeasonAdmin(season.id);
  const snapshot=await db.transaction(tx=>readBetOperationsSnapshot(tx,season.id),{accessMode:"read only",isolationLevel:"repeatable read"});
  const data=projectBetBoard(snapshot);
  return <BetOperations data={data} slug={seasonSlug} pending={snapshot.program?.dirty??false} query={parseBetOperationsQuery(await searchParams)}/>;
}
