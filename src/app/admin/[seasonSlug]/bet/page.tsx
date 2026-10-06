import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons,betPrograms } from "@/db/schema";
import { requireSeasonAdmin } from "@/lib/auth/session";
import { betBoard } from "@/lib/bet/data";
import { BetOperations } from "@/components/bet/BetOperations";
export default async function BetAdminPage({params}:{params:Promise<{seasonSlug:string}>}) {
  const {seasonSlug}=await params;const season=await db.query.seasons.findFirst({where:eq(seasons.slug,seasonSlug)});
  if(!season || season.competitionTemplate!=="major")notFound();await requireSeasonAdmin(season.id);
  const data=await db.transaction(tx=>betBoard(tx,season.id,null),{accessMode:"read only",isolationLevel:"repeatable read"});
  const program=await db.query.betPrograms.findFirst({where:eq(betPrograms.seasonId,season.id)});
  return <BetOperations data={data} slug={seasonSlug} pending={program?.dirty??false}/>;
}
