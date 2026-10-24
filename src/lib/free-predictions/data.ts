import { projectDisplayScore } from "@/lib/matches/display-score";
import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { freePredictionChoices as choices, freePredictionLocks as locks, users, competitionQualificationRuns } from "@/db/schema";
import { getCanonicalUserSourceIds, resolveCanonicalUserId } from "@/lib/identity/canonical";
import { loadBetFacts, type BetFacts } from "@/lib/bet/facts";
import { marketIsLocked, subjectMatches } from "@/lib/bet/domain";
import { normalizeRegistrationConfig } from "@/lib/seasons/compatibility";
import { predictionInput, gradePrediction, freePredictionRestriction, freePredictionCompetitionIsOpen } from "./domain";
import type { FreePredictionMatchDTO, FreePredictionSubject } from "./types";
export interface FreePredictionSupportSnapshot {
  signature: string;
  matches: {matchId:string;result:FreePredictionMatchDTO["result"]["support"];bp:FreePredictionMatchDTO["bp"]["support"]}[];
}
export interface FreePredictionReadScope { matchId?: string; facts?: BetFacts; publicSupport?: FreePredictionSupportSnapshot; populationUserId?: string | null }
/** Bind aggregate votes to the current official subjects, veto pool and validity. */
export function freePredictionSupportSignature(facts: BetFacts): string {
  return JSON.stringify(facts.official.map(m => [m.id,m.entryAId,m.entryBId,m.majorStageRunId,m.qualificationRunId,m.format,m.status,m.isForfeit,
    facts.vetoByMatch.get(m.id)?.mapPoolSnapshot ?? normalizeRegistrationConfig(facts.season.registrationConfig).mapPool]));
}
export async function loadFreePredictionPopulation(tx: TxDb, seasonId: string, scope: FreePredictionReadScope = {}) {
  const facts = scope.facts ?? await loadBetFacts(tx,seasonId,{matchId:scope.matchId,event:false,rosterUserId:null});
  const sourceIds = scope.populationUserId ? await getCanonicalUserSourceIds(tx,scope.populationUserId) : undefined;
  const rows = scope.populationUserId === null || sourceIds?.length === 0 ? [] : await tx.select().from(choices).where(and(eq(choices.seasonId,seasonId),scope.matchId ? eq(choices.matchId,scope.matchId) : undefined,sourceIds ? inArray(choices.userId,sourceIds) : undefined));
  // Original attribution/revisions stay immutable across identity merge. Project one
  // current vote per canonical person, retaining the selected account's choice.
  const identities = !sourceIds && rows.length ? await tx.select({id:users.id,status:users.status}).from(users).where(inArray(users.id,[...new Set(rows.map(r=>r.userId))])) : [];
  // The source owner already resolved every private row to this active viewer
  // in the same repeatable-read snapshot; reuse that result for alias choices.
  const canonicalIds = new Map<string,string>(sourceIds?.map(id => [id, scope.populationUserId!]));
  for (const identity of identities) {
    const id = identity.status === "active" ? identity.id : await resolveCanonicalUserId(tx,identity.id);
    if (id) canonicalIds.set(identity.id,id);
  }
  const effective = new Map<string,{row:typeof choices.$inferSelect; direct:boolean}>();
  for (const row of rows) {
    const userId = canonicalIds.get(row.userId); if (!userId) continue;
    const key = `${userId}/${row.matchId}/${row.kind}`; const direct=row.userId===userId;
    const previous=effective.get(key);
    if (!previous || (direct && !previous.direct) || (direct===previous.direct && row.updatedAt>previous.row.updatedAt)) effective.set(key,{row:{...row,userId},direct});
  }
  return { facts, rows:[...effective.values()].map(v=>v.row) };
}
export function choiceFact(row: typeof choices.$inferSelect, f: BetFacts) {
  return predictionInput(row.subject,{match:f.official.find(m=>m.id===row.matchId),maps:f.maps.filter(m=>m.matchId===row.matchId),veto:f.vetoByMatch.get(row.matchId),event:f.event});
}
/** Only mine contains selections; anonymous payload contains no voter identity. */
export async function readFreePredictionSnapshot(tx: TxDb, seasonId: string, userId: string | null, scope: FreePredictionReadScope = {}) {
  const facts = scope.facts ?? await loadBetFacts(tx,seasonId,{matchId:scope.matchId,event:false,rosterUserId:null});
  const support = scope.publicSupport?.signature === freePredictionSupportSignature(facts) ? scope.publicSupport : undefined;
  const {facts:f,rows} = await loadFreePredictionPopulation(tx,seasonId,{...scope,facts,populationUserId:support ? userId : undefined});
  const fences = await tx.select().from(locks).where(and(eq(locks.seasonId,seasonId),scope.matchId ? eq(locks.matchId,scope.matchId) : undefined));
  const qualificationRuns = await tx.select().from(competitionQualificationRuns).where(eq(competitionQualificationRuns.seasonId, seasonId));
  const user = userId ? await tx.query.users.findFirst({where:(u,{eq})=>eq(u.id,userId),columns:{status:true,emailVerifiedAt:true}}) : undefined;
  return {seasonId,userId,f,rows,support,fences,qualificationRuns,user};
}
export function projectFreePredictionBoard(snapshot: Awaited<ReturnType<typeof readFreePredictionSnapshot>>): {seasonId:string;matches:FreePredictionMatchDTO[]} {
  const {seasonId,userId,f,rows,support,fences,qualificationRuns,user}=snapshot;
  const result: FreePredictionMatchDTO[] = [];
  for (const m of f.official) {
    if (!m.majorStageRunId && !m.qualificationRunId) continue;
    const veto = f.vetoByMatch.get(m.id);
    const mapPool = veto?.mapPoolSnapshot ?? normalizeRegistrationConfig(f.season.registrationConfig).mapPool;
    const subject: FreePredictionSubject = {entryIds:[m.entryAId,m.entryBId],runId:(m.majorStageRunId??m.qualificationRunId)!,format:m.format,mapPool:[]};
    const fact = predictionInput(subject,{match:m,maps:f.maps.filter(map=>map.matchId===m.id),veto,event:f.event});
    const fence = fences.find(l=>l.matchId===m.id);
    const publicCounts = freeSupportForMatch(m,f,rows);
    const shared = support?.matches.find(row=>row.matchId===m.id);
    const myResult = rows.find(r=>r.matchId===m.id && r.kind === "result" && r.userId===userId);
    const myBp = rows.find(r=>r.matchId===m.id && r.kind === "bp" && r.userId===userId);
    const resultLocked = !!fence?.resultLockedAt || marketIsLocked(fact);
    const bpLocked = !!fence?.bpLockedAt || marketIsLocked({...fact,type:"veto_map"});
    const competitionOpen = freePredictionCompetitionIsOpen(f.season, m, qualificationRuns.find(run => run.id === m.qualificationRunId));
    const eligibility={status:m.status,isForfeit:m.isForfeit,competitionOpen,signedIn:!!userId,active:user?.status==="active",verified:!!user?.emailVerifiedAt};
    const resultRestriction=freePredictionRestriction({...eligibility,locked:resultLocked,validMapPool:true});
    const bpRestriction=freePredictionRestriction({...eligibility,locked:bpLocked,validMapPool:mapPool.length>=Number(m.format.slice(2))});
    result.push({matchId:m.id,status:m.status,displayScore:projectDisplayScore(m,f.maps.filter(map=>map.matchId===m.id)),isForfeit:m.isForfeit,a:f.entries.find(e=>e.id===m.entryAId)?.name??"队伍",b:f.entries.find(e=>e.id===m.entryBId)?.name??"队伍",logoA:f.entries.find(e=>e.id===m.entryAId)?.logoUrl??null,logoB:f.entries.find(e=>e.id===m.entryBId)?.logoUrl??null,stage:m.qualificationRunId?"PLAY-IN":f.season.stagePlan.find(s=>s.key===m.stage)?.name??"正赛",scheduledAt:m.scheduledAt?.toISOString()??null,entryIds:subject.entryIds,format:m.format,mapPool,
      result:{locked:resultLocked,canSubmit:!resultRestriction,restriction:resultRestriction,mine:myResult?.selection[0]??null,grade:myResult?gradePrediction("result",myResult.selection,choiceFact(myResult,f)):null,
        support:shared?.result ?? publicCounts.result},
      bp:{locked:bpLocked,canSubmit:!bpRestriction,restriction:bpRestriction,mine:myBp?.selection??null,grade:myBp?gradePrediction("bp",myBp.selection,choiceFact(myBp,f)):null,
        support:shared?.bp ?? publicCounts.bp}});
  }
  return {seasonId,matches:result};
}
export async function readFreePredictionBoard(tx: TxDb, seasonId: string, userId: string | null, scope: FreePredictionReadScope = {}) {
  return projectFreePredictionBoard(await readFreePredictionSnapshot(tx,seasonId,userId,scope));
}
export async function readFreeMatchSupport(tx: TxDb, seasonId: string, matchId: string) {
  return (await readFreePredictionBoard(tx,seasonId,null,{matchId})).matches.find(m=>m.matchId===matchId)?.result.support ?? null;
}

/** Shared support owns canonical vote validity without building viewer panels. */
function freeSupportForMatch(m: BetFacts["official"][number], f: BetFacts, rows: Awaited<ReturnType<typeof loadFreePredictionPopulation>>["rows"]) {
  const veto=f.vetoByMatch.get(m.id);
  const maps=f.maps.filter(map=>map.matchId===m.id);
  const mapPool=veto?.mapPoolSnapshot??normalizeRegistrationConfig(f.season.registrationConfig).mapPool;
  const valid=rows.filter(row=>row.matchId===m.id && subjectMatches({...row.subject,kind:"match"},m,maps,veto) && !m.isForfeit && m.status!=="cancelled");
  const votes=valid.filter(row=>row.kind==="result"), bp=valid.filter(row=>row.kind==="bp");
  const counts: [number,number]=[votes.filter(row=>row.selection[0]===m.entryAId).length,votes.filter(row=>row.selection[0]===m.entryBId).length];
  return {result:{total:votes.length,counts,percentages:votes.length?[counts[0]*100/votes.length,counts[1]*100/votes.length] as [number,number]:null},
    bp:{total:bp.length,maps:mapPool.map(name=>({name,count:bp.filter(row=>row.selection.includes(name)).length}))}};
}
export function projectFreePredictionSupport({facts,rows}: Awaited<ReturnType<typeof loadFreePredictionPopulation>>) {
  return {signature:freePredictionSupportSignature(facts),matches:facts.official.filter(m=>m.majorStageRunId||m.qualificationRunId)
    .map(m=>({matchId:m.id,...freeSupportForMatch(m,facts,rows)}))};
}
