import "server-only";
import { and, eq, inArray, asc } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { seasons, matches, matchMaps, matchVetoSessions, matchVetoSteps, matchVetoAppeals, matchVetoTimeoutIncidents, competitionEntries } from "@/db/schema";
import { officialMatchCondition } from "@/lib/matches/scope";
import { requireCompetitionMatch } from "@/lib/matches/competition-context";
import { vetoGameplayExists } from "@/lib/matches/veto-room/appeal-lifecycle";
import { AppError, ErrorCode } from "@/lib/errors";
import type { VetoFact } from "./spectator-facts";

export async function loadMatchFacts(tx: TxDb, seasonId: string, scope: {matchId?: string} = {}, existingSeason?: typeof seasons.$inferSelect) {
  const season = existingSeason ?? await tx.query.seasons.findFirst({where:eq(seasons.id,seasonId)});
  if (!season) throw new AppError(ErrorCode.NOT_FOUND,"赛事不存在");
  const matchCondition = and(officialMatchCondition(), eq(matches.seasonId,seasonId), scope.matchId ? eq(matches.id,scope.matchId) : undefined);
  const officialRows = await tx.select({id:matches.id,seasonId:matches.seasonId,entryAId:matches.entryAId,entryBId:matches.entryBId,stage:matches.stage,format:matches.format,entryRound:matches.entryRound,majorStageRunId:matches.majorStageRunId,qualificationRunId:matches.qualificationRunId,scoreA:matches.scoreA,scoreB:matches.scoreB,status:matches.status,isForfeit:matches.isForfeit,resultDisposition:matches.resultDisposition,startedAt:matches.startedAt,gameplayStartedAt:matches.gameplayStartedAt,scheduledAt:matches.scheduledAt,completedAt:matches.completedAt}).from(matches).where(matchCondition).orderBy(asc(matches.createdAt)).then(rows=>rows.map(requireCompetitionMatch).map(m=>({...m,operationalStartedAt:m.startedAt,startedAt:m.gameplayStartedAt})));
  const maps = await tx.select({map:{id:matchMaps.id,matchId:matchMaps.matchId,mapOrder:matchMaps.mapOrder,mapName:matchMaps.mapName,scoreA:matchMaps.scoreA,scoreB:matchMaps.scoreB,startedAt:matchMaps.startedAt,completedAt:matchMaps.completedAt}}).from(matchMaps).innerJoin(matches,eq(matches.id,matchMaps.matchId)).where(matchCondition).then(rows=>rows.map(r=>r.map));
  // Canonical map facts also prove gameplay when the separate start marker is absent.
  const official = officialRows.map(m => ({...m,startedAt:m.startedAt ?? maps
    .filter(map=>map.matchId===m.id && (map.startedAt || map.completedAt))
    .map(map=>map.startedAt ?? map.completedAt!)
    .sort((a,b)=>a.getTime()-b.getTime())[0] ?? null}));
  const vetos = await tx.select({veto:{matchId:matchVetoSessions.matchId,mapPoolSnapshot:matchVetoSessions.mapPoolSnapshot,startedAt:matchVetoSessions.startedAt,completedAt:matchVetoSessions.completedAt}}).from(matchVetoSessions).innerJoin(matches,eq(matches.id,matchVetoSessions.matchId)).where(matchCondition).then(rows=>rows.map(r=>r.veto));
  const vetoSteps = await tx.select({matchId:matchVetoSteps.matchId,stepOrder:matchVetoSteps.stepOrder,actionType:matchVetoSteps.actionType,mapName:matchVetoSteps.mapName})
    .from(matchVetoSteps).innerJoin(matches,eq(matches.id,matchVetoSteps.matchId)).where(and(matchCondition,inArray(matchVetoSteps.actionType,["pick","decider"]))).orderBy(asc(matchVetoSteps.stepOrder));
  const appeals = await tx.select({matchId:matchVetoTimeoutIncidents.matchId,gameplay:vetoGameplayExists(matchVetoTimeoutIncidents.matchId)}).from(matchVetoAppeals).innerJoin(matchVetoTimeoutIncidents,eq(matchVetoTimeoutIncidents.id,matchVetoAppeals.timeoutIncidentId)).innerJoin(matches,eq(matches.id,matchVetoTimeoutIncidents.matchId)).where(and(matchCondition,eq(matchVetoAppeals.status,"pending")));
  // Reader-only rollout retains pending history. Gameplay ends its BP recovery
  // effect even before the closed producer is shipped; settlement must continue.
  const recoverableAppeals = new Set(appeals.filter(appeal=>!appeal.gameplay).map(appeal=>appeal.matchId));
  const vetoByMatch = new Map<string,VetoFact>(vetos.map(v=>[v.matchId,{...v,steps:vetoSteps.filter(step=>step.matchId===v.matchId),pendingAppeal:recoverableAppeals.has(v.matchId)}]));
  const entries = await tx.select({id:competitionEntries.id,name:competitionEntries.name,logoUrl:competitionEntries.logoUrl}).from(competitionEntries).where(eq(competitionEntries.competitionId,seasonId));
  return {season,official,maps,vetoByMatch,entries};
}
export type MatchFacts = Awaited<ReturnType<typeof loadMatchFacts>>;

/** Public support needs subjects and frozen pools, not operational or private facts. */
export async function loadMatchPublicSupportFacts(tx: TxDb, seasonId: string, matchId?: string) {
  const [season] = await tx.select({registrationConfig: seasons.registrationConfig}).from(seasons).where(eq(seasons.id,seasonId));
  if (!season) throw new AppError(ErrorCode.NOT_FOUND,"赛事不存在");
  const condition = and(officialMatchCondition(),eq(matches.seasonId,seasonId),matchId ? eq(matches.id,matchId) : undefined);
  const official = await tx.select({id:matches.id,seasonId:matches.seasonId,stage:matches.stage,entryAId:matches.entryAId,entryBId:matches.entryBId,majorStageRunId:matches.majorStageRunId,qualificationRunId:matches.qualificationRunId,format:matches.format,status:matches.status,isForfeit:matches.isForfeit}).from(matches).where(condition).orderBy(asc(matches.createdAt)).then(rows=>rows.map(requireCompetitionMatch));
  const vetos = await tx.select({matchId:matchVetoSessions.matchId,mapPoolSnapshot:matchVetoSessions.mapPoolSnapshot}).from(matchVetoSessions).innerJoin(matches,eq(matches.id,matchVetoSessions.matchId)).where(condition);
  return {season,official,vetoByMatch:new Map(vetos.map(v=>[v.matchId,{mapPoolSnapshot:v.mapPoolSnapshot}]))};
}
export type MatchPublicSupportFacts = Awaited<ReturnType<typeof loadMatchPublicSupportFacts>>;
