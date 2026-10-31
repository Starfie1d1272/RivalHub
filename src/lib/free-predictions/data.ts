import { projectDisplayScore } from "@/lib/matches/display-score";
import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { freePredictionChoices as choices, freePredictionLocks as locks, users, competitionQualificationRuns } from "@/db/schema";
import { getCanonicalUserSourceIds, resolveCanonicalUserId } from "@/lib/identity/canonical";
import { loadBetFacts, type BetFacts, type BetPublicSupportFacts } from "@/lib/bet/facts";
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
export function freePredictionSupportSignature(facts: BetPublicSupportFacts): string {
  return JSON.stringify(facts.official.map(m => [m.id,m.entryAId,m.entryBId,m.majorStageRunId,m.qualificationRunId,m.format,m.status,m.isForfeit,
    facts.vetoByMatch.get(m.id)?.mapPoolSnapshot ?? normalizeRegistrationConfig(facts.season.registrationConfig).mapPool]));
}
export async function loadFreePredictionPopulation(tx: TxDb, seasonId: string, scope: FreePredictionReadScope = {}) {
  const facts = scope.facts ?? await loadBetFacts(tx,seasonId,{matchId:scope.matchId,event:false,rosterUserId:null});
  const sourceIds = scope.populationUserId ? await getCanonicalUserSourceIds(tx,scope.populationUserId) : undefined;
  const rows = scope.populationUserId === null || sourceIds?.length === 0 ? [] : await tx.select().from(choices).where(and(eq(choices.seasonId,seasonId),scope.matchId ? eq(choices.matchId,scope.matchId) : undefined,sourceIds ? inArray(choices.userId,sourceIds) : undefined));
  return { facts, rows: await canonicalChoices(tx, rows, sourceIds, scope.populationUserId) };
}
async function canonicalChoices<T extends Pick<typeof choices.$inferSelect, "userId" | "matchId" | "kind" | "updatedAt">>(tx: TxDb, rows: T[], sourceIds?: string[], populationUserId?: string | null) {
  // Original attribution/revisions stay immutable across identity merge. Project one
  // current vote per canonical person, retaining the selected account's choice.
  const identities = !sourceIds && rows.length ? await tx.select({id:users.id,status:users.status}).from(users).where(inArray(users.id,[...new Set(rows.map(r=>r.userId))])) : [];
  // The source owner already resolved every private row to this active viewer
  // in the same repeatable-read snapshot; reuse that result for alias choices.
  const canonicalIds = new Map<string,string>(sourceIds?.map(id => [id, populationUserId!]));
  for (const identity of identities) {
    const id = identity.status === "active" ? identity.id : await resolveCanonicalUserId(tx,identity.id);
    if (id) canonicalIds.set(identity.id,id);
  }
  const effective = new Map<string,{row:T; direct:boolean}>();
  for (const row of rows) {
    const userId = canonicalIds.get(row.userId); if (!userId) continue;
    const key = `${userId}/${row.matchId}/${row.kind}`; const direct=row.userId===userId;
    const previous=effective.get(key);
    if (!previous || (direct && !previous.direct) || (direct===previous.direct && row.updatedAt>previous.row.updatedAt)) effective.set(key,{row:{...row,userId},direct});
  }
  return [...effective.values()].map(v=>v.row);
}
export async function loadPublicPredictionPopulation(tx: TxDb, seasonId: string, facts: BetPublicSupportFacts, matchId?: string) {
  const rows = await tx.select({userId:choices.userId,matchId:choices.matchId,kind:choices.kind,subject:choices.subject,selection:choices.selection,updatedAt:choices.updatedAt}).from(choices).where(and(eq(choices.seasonId,seasonId),matchId ? eq(choices.matchId,matchId) : undefined));
  return {facts,rows:await canonicalChoices(tx,rows)};
}
/** Aggregate only unambiguous active-account choices; all other data retains the canonical reader. */
export async function readPublicPredictionSupport(tx: TxDb, seasonId: string, facts: BetPublicSupportFacts, matchId?: string): Promise<FreePredictionSupportSnapshot> {
  const fallback = async () => projectFreePredictionSupport(await loadPublicPredictionPopulation(tx, seasonId, facts, matchId));
  const safePool = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string" && item.length > 0 && !item.includes(","));
  const rows = facts.official.map((m, index) => {
    const vetoPool = facts.vetoByMatch.get(m.id)?.mapPoolSnapshot ?? null;
    const displayPool = vetoPool ?? normalizeRegistrationConfig(facts.season.registrationConfig).mapPool;
    return { index, matchId: m.id, entryAId: m.entryAId, entryBId: m.entryBId,
      runId: m.majorStageRunId ?? m.qualificationRunId, format: m.format, status: m.status, isForfeit: m.isForfeit, vetoPool, displayPool };
  });
  if (rows.some(row => (row.vetoPool !== null && !safePool(row.vetoPool)) || !safePool(row.displayPool))) return fallback();
  const result = await tx.execute<{ fallback_required: boolean; counts: unknown }>(sql`
    WITH scoped AS MATERIALIZED (
      SELECT c.user_id, c.match_id, c.kind, c.subject, c.selection, u.status AS user_status
      FROM free_prediction_choices c LEFT JOIN users u ON u.id = c.user_id
      WHERE c.season_id = ${seasonId} ${matchId ? sql`AND c.match_id = ${matchId}` : sql``}
    ), guarded AS (
      SELECT *, CASE WHEN jsonb_typeof(subject->'entryIds') = 'array' THEN subject->'entryIds' ELSE '[]'::jsonb END AS entries,
        CASE WHEN jsonb_typeof(subject->'mapPool') = 'array' THEN subject->'mapPool' ELSE '[]'::jsonb END AS pool,
        CASE WHEN jsonb_typeof(selection) = 'array' THEN selection ELSE '[]'::jsonb END AS picks
      FROM scoped
    ), invalid AS (
      SELECT EXISTS (SELECT 1 FROM guarded g WHERE
        g.user_status IS DISTINCT FROM 'active' OR jsonb_typeof(g.subject) IS DISTINCT FROM 'object'
        OR jsonb_typeof(g.subject->'entryIds') IS DISTINCT FROM 'array' OR jsonb_array_length(g.entries) <> 2
        OR jsonb_typeof(g.subject->'runId') IS DISTINCT FROM 'string' OR jsonb_typeof(g.subject->'format') IS DISTINCT FROM 'string'
        OR jsonb_typeof(g.subject->'mapPool') IS DISTINCT FROM 'array' OR jsonb_typeof(g.selection) IS DISTINCT FROM 'array'
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(g.entries) e WHERE jsonb_typeof(e) IS DISTINCT FROM 'string')
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(g.pool) e WHERE jsonb_typeof(e) IS DISTINCT FROM 'string' OR e #>> '{}' = '' OR position(',' in (e #>> '{}')) > 0)
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(g.picks) e WHERE jsonb_typeof(e) IS DISTINCT FROM 'string')
      ) AS fallback_required
    ), facts AS (
      SELECT * FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS f(
        "index" int, "matchId" text, "entryAId" text, "entryBId" text, "runId" text, format text,
        status text, "isForfeit" boolean, "vetoPool" jsonb, "displayPool" jsonb)
    ), eligible AS (
      SELECT f."index", f."entryAId", f."entryBId", g.kind, g.picks
      FROM facts f JOIN guarded g ON g.match_id::text = f."matchId"
      WHERE NOT (SELECT fallback_required FROM invalid) AND f."runId" IS NOT NULL AND NOT f."isForfeit" AND f.status <> 'cancelled'
        AND g.entries->>0 = f."entryAId" AND g.entries->>1 = f."entryBId"
        AND g.subject->>'runId' = f."runId" AND g.subject->>'format' = f.format
        AND (jsonb_array_length(g.pool) = 0 OR f."vetoPool" IS NULL OR NOT EXISTS (
          (SELECT value COLLATE "C" FROM jsonb_array_elements_text(g.pool) EXCEPT ALL SELECT value COLLATE "C" FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(f."vetoPool") = 'array' THEN f."vetoPool" ELSE '[]'::jsonb END))
          UNION ALL
          (SELECT value COLLATE "C" FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(f."vetoPool") = 'array' THEN f."vetoPool" ELSE '[]'::jsonb END) EXCEPT ALL SELECT value COLLATE "C" FROM jsonb_array_elements_text(g.pool))
        ))
    )
    SELECT invalid.fallback_required, CASE WHEN invalid.fallback_required THEN NULL ELSE COALESCE((
      SELECT jsonb_agg(jsonb_build_array(f."index",
        (SELECT count(*) FROM eligible e WHERE e."index" = f."index" AND e.kind = 'result'),
        (SELECT count(*) FROM eligible e WHERE e."index" = f."index" AND e.kind = 'result' AND e.picks->>0 = f."entryAId"),
        (SELECT count(*) FROM eligible e WHERE e."index" = f."index" AND e.kind = 'result' AND e.picks->>0 = f."entryBId"),
        (SELECT count(*) FROM eligible e WHERE e."index" = f."index" AND e.kind = 'bp'),
        (SELECT COALESCE(jsonb_agg((SELECT count(*) FROM eligible e WHERE e."index" = f."index" AND e.kind = 'bp' AND e.picks ? map.value) ORDER BY map.ordinality), '[]'::jsonb)
          FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(f."displayPool") = 'array' THEN f."displayPool" ELSE '[]'::jsonb END) WITH ORDINALITY map(value, ordinality))) ORDER BY f."index")
      FROM facts f WHERE f."runId" IS NOT NULL
    ), '[]'::jsonb) END AS counts FROM invalid
  `);
  const row = result.rows[0];
  if (!row || row.fallback_required) return fallback();
  const counts = row.counts as Array<[number, number, number, number, number, number[]]>;
  return { signature: freePredictionSupportSignature(facts), matches: counts.map(([index,total,a,b,bpTotal,bpCounts]) => {
    const fact = rows[index]!;
    return { matchId: fact.matchId, result: { total, counts: [a,b], percentages: total ? [a*100/total,b*100/total] : null },
      bp: { total: bpTotal, maps: fact.displayPool.map((name, i) => ({ name, count: bpCounts[i]! })) } };
  }) };
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
function freeSupportForMatch(m: BetPublicSupportFacts["official"][number], f: BetPublicSupportFacts, rows: Awaited<ReturnType<typeof loadPublicPredictionPopulation>>["rows"]) {
  const veto=f.vetoByMatch.get(m.id);
  const mapPool=veto?.mapPoolSnapshot??normalizeRegistrationConfig(f.season.registrationConfig).mapPool;
  const valid=rows.filter(row=>row.matchId===m.id && subjectMatches({...row.subject,kind:"match"},m,[],veto) && !m.isForfeit && m.status!=="cancelled");
  const votes=valid.filter(row=>row.kind==="result"), bp=valid.filter(row=>row.kind==="bp");
  const counts: [number,number]=[votes.filter(row=>row.selection[0]===m.entryAId).length,votes.filter(row=>row.selection[0]===m.entryBId).length];
  return {result:{total:votes.length,counts,percentages:votes.length?[counts[0]*100/votes.length,counts[1]*100/votes.length] as [number,number]:null},
    bp:{total:bp.length,maps:mapPool.map(name=>({name,count:bp.filter(row=>row.selection.includes(name)).length}))}};
}
export function projectFreePredictionSupport({facts,rows}: Awaited<ReturnType<typeof loadPublicPredictionPopulation>>) {
  return {signature:freePredictionSupportSignature(facts),matches:facts.official.filter(m=>m.majorStageRunId||m.qualificationRunId)
    .map(m=>({matchId:m.id,...freeSupportForMatch(m,facts,rows)}))};
}
