import "server-only";
import { and, eq, asc, sql } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { matches, matchMaps, matchVetoSessions } from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";
import { writeAuditInTx } from "@/lib/audit/write";
/** Caller holds canonical match lock. The first accepted start survives reconnects. */
export async function startCanonicalMapInTx(tx:TxDb,matchId:string,mapId:string,actorId:string) {
  const match=await tx.query.matches.findFirst({where:eq(matches.id,matchId)});
  const veto=await tx.query.matchVetoSessions.findFirst({where:eq(matchVetoSessions.matchId,matchId)});
  const maps=await tx.select().from(matchMaps).where(eq(matchMaps.matchId,matchId)).orderBy(asc(matchMaps.mapOrder));
  const next=maps.find(m=>!m.completedAt);
  if(!match || match.status!=="in_progress" || !veto?.completedAt || !next || next.id!==mapId) throw new AppError(ErrorCode.VALIDATION_FAILED,"请先完成 BP，并核对当前正式待进行地图");
  if(next.startedAt) return;
  await tx.update(matchMaps).set({startedAt:sql`clock_timestamp()`}).where(and(eq(matchMaps.id,mapId),eq(matchMaps.matchId,matchId)));
  if(!match.gameplayStartedAt) await tx.update(matches).set({gameplayStartedAt:sql`clock_timestamp()`}).where(eq(matches.id,matchId));
  await writeAuditInTx(tx,{seasonId:match.seasonId,actorId,action:"match.map.start",targetId:matchId,meta:{mapId,mapOrder:next.mapOrder}});
}
