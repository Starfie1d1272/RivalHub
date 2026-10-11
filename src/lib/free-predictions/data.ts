import "server-only";
import { eq } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { freePredictionChoices as choices, freePredictionLocks as locks } from "@/db/schema";
import { loadBetFacts, type BetFacts } from "@/lib/bet/facts";
import { marketIsLocked, subjectMatches } from "@/lib/bet/domain";
import { normalizeRegistrationConfig } from "@/lib/seasons/compatibility";
import { predictionInput, gradePrediction } from "./domain";
import type { FreePredictionMatchDTO, FreePredictionSubject } from "./types";
export async function loadFreePredictionPopulation(tx: TxDb, seasonId: string) {
  const facts = await loadBetFacts(tx,seasonId);
  const rows = await tx.select().from(choices).where(eq(choices.seasonId,seasonId));
  return { facts, rows };
}
export function choiceFact(row: typeof choices.$inferSelect, f: BetFacts) {
  return predictionInput(row.subject,{match:f.official.find(m=>m.id===row.matchId),maps:f.maps.filter(m=>m.matchId===row.matchId),veto:f.vetoByMatch.get(row.matchId),event:f.event});
}
/** Only mine contains selections; anonymous payload contains no voter identity. */
export async function readFreePredictionBoard(tx: TxDb, seasonId: string, userId: string | null): Promise<{seasonId:string;matches:FreePredictionMatchDTO[]}> {
  const {facts:f,rows} = await loadFreePredictionPopulation(tx,seasonId);
  const fences = await tx.select().from(locks).where(eq(locks.seasonId,seasonId));
  const user = userId ? await tx.query.users.findFirst({where:(u,{eq})=>eq(u.id,userId),columns:{status:true,emailVerifiedAt:true}}) : undefined;
  const canUse = !!user && user.status === "active" && !!user.emailVerifiedAt && ["playing","drafting"].includes(f.season.status);
  const result: FreePredictionMatchDTO[] = [];
  for (const m of f.official) {
    if (!m.majorStageRunId && !m.qualificationRunId) continue;
    const veto = f.vetoByMatch.get(m.id);
    const mapPool = veto?.mapPoolSnapshot ?? normalizeRegistrationConfig(f.season.registrationConfig).mapPool;
    const subject: FreePredictionSubject = {entryIds:[m.entryAId,m.entryBId],runId:(m.majorStageRunId??m.qualificationRunId)!,format:m.format,mapPool:[]};
    const fact = predictionInput(subject,{match:m,maps:f.maps.filter(map=>map.matchId===m.id),veto,event:f.event});
    const fence = fences.find(l=>l.matchId===m.id);
    const valid = rows.filter(r=>r.matchId===m.id && subjectMatches({...r.subject,kind:"match"},m,fact.maps,veto) && !m.isForfeit && m.status !== "cancelled");
    const votes = valid.filter(r=>r.kind === "result");
    const bp = valid.filter(r=>r.kind === "bp");
    const counts: [number,number] = [votes.filter(r=>r.selection[0]===m.entryAId).length,votes.filter(r=>r.selection[0]===m.entryBId).length];
    const myResult = rows.find(r=>r.matchId===m.id && r.kind === "result" && r.userId===userId);
    const myBp = rows.find(r=>r.matchId===m.id && r.kind === "bp" && r.userId===userId);
    const resultLocked = !!fence?.resultLockedAt || marketIsLocked(fact);
    const bpLocked = !!fence?.bpLockedAt || marketIsLocked({...fact,type:"veto_map"});
    result.push({matchId:m.id,a:f.entries.find(e=>e.id===m.entryAId)?.name??"队伍",b:f.entries.find(e=>e.id===m.entryBId)?.name??"队伍",logoA:f.entries.find(e=>e.id===m.entryAId)?.logoUrl??null,logoB:f.entries.find(e=>e.id===m.entryBId)?.logoUrl??null,stage:m.qualificationRunId?"PLAY-IN":f.season.stagePlan.find(s=>s.key===m.stage)?.name??"正赛",scheduledAt:m.scheduledAt?.toISOString()??null,entryIds:subject.entryIds,format:m.format,mapPool,
      result:{locked:resultLocked,canSubmit:canUse&&!resultLocked,mine:myResult?.selection[0]??null,grade:myResult?gradePrediction("result",myResult.selection,choiceFact(myResult,f)):null,
        support:{total:votes.length,counts,percentages:votes.length?[counts[0]*100/votes.length,counts[1]*100/votes.length]:null}},
      bp:{locked:bpLocked,canSubmit:canUse&&!bpLocked&&mapPool.length>=Number(m.format.slice(2)),mine:myBp?.selection??null,grade:myBp?gradePrediction("bp",myBp.selection,choiceFact(myBp,f)):null,
        support:{total:bp.length,maps:mapPool.map(name=>({name,count:bp.filter(r=>r.selection.includes(name)).length}))}}});
  }
  return {seasonId,matches:result};
}
export async function readFreeMatchSupport(tx: TxDb, seasonId: string, matchId: string) {
  return (await readFreePredictionBoard(tx,seasonId,null)).matches.find(m=>m.matchId===matchId)?.result.support ?? null;
}
