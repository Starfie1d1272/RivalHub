import { officialMatchCondition } from "@/lib/matches/scope";
import { requireCompetitionMatch } from "@/lib/matches/competition-context";
import { vetoGameplayExists } from "@/lib/matches/veto-room/appeal-lifecycle";
import "server-only";
import { and, eq, inArray, isNotNull, asc } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { seasons, matches, matchMaps, matchVetoSessions, matchVetoSteps, matchVetoAppeals, matchVetoTimeoutIncidents, competitionEntries, majorFinalResults, majorPrestartStates, majorTournamentEntrants, competitionQualificationRuns, eventRosterMembers, eventRosters, users, steamProfiles, matchPlayerStats, matchDemoImports } from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";
import { getDisplayName } from "@/lib/identity/display-name";
import { resolveManagedMajorProfile } from "@/lib/competition/definition";
import type { EventFact, MapFact, VetoFact } from "./domain";
export interface BetFactScope {
  matchId?: string;
  event?: boolean;
  headerOnly?: boolean;
  // Undefined loads the complete roster for lifecycle owners; null loads none.
  rosterUserId?: string | null;
}
export async function loadBetFacts(tx: TxDb,seasonId: string, scope: BetFactScope = {}) {
  const season = await tx.query.seasons.findFirst({where:eq(seasons.id,seasonId)});
  if (!season) throw new AppError(ErrorCode.NOT_FOUND,"赛事不存在");
  if (scope.headerOnly) {
    const entries = await tx.select({id:competitionEntries.id,name:competitionEntries.name,logoUrl:competitionEntries.logoUrl}).from(competitionEntries).where(eq(competitionEntries.competitionId,seasonId));
    return {season,entries,official:[] as Awaited<ReturnType<typeof loadMatchFacts>>["official"],
      maps:[] as MapFact[],vetoByMatch:new Map<string,VetoFact>(),roster:[],players:[],
      event:{entryIds:[],playerIds:[],started:false,champion:null,kills:null} as EventFact,
      eventPublication:{entrantsReady:false,rostersReady:false,seedsConfirmed:false}};
  }
  return loadMatchFacts(tx,seasonId,season,scope);
}
async function loadMatchFacts(tx: TxDb, seasonId: string, season: typeof seasons.$inferSelect, scope: BetFactScope) {
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
  const roster = scope.rosterUserId === null ? [] : await tx.select({entryId:eventRosters.entryId,userId:eventRosterMembers.userId,name:users.displayName,perfectName:users.perfectName,personaName:steamProfiles.personaName,current:eventRosterMembers.isCurrent}).from(eventRosterMembers).innerJoin(eventRosters,eq(eventRosters.id,eventRosterMembers.eventRosterId)).innerJoin(competitionEntries,eq(competitionEntries.id,eventRosters.entryId)).innerJoin(users,eq(users.id,eventRosterMembers.userId)).leftJoin(steamProfiles,eq(steamProfiles.steam64,users.steam64)).where(and(eq(competitionEntries.competitionId,seasonId),inArray(eventRosters.status,["confirmed","frozen"]), scope.rosterUserId ? eq(eventRosterMembers.userId,scope.rosterUserId) : undefined));
  if (scope.event === false) {
    return {season,official,maps,vetoByMatch,entries,roster,players:[] as {id:string;name:string}[],
      event:{entryIds:[],playerIds:[],started:false,champion:null,kills:null} as EventFact,
      eventPublication:{entrantsReady:false,rostersReady:false,seedsConfirmed:false}};
  }
  const prestart = await tx.query.majorPrestartStates.findFirst({where:eq(majorPrestartStates.seasonId,seasonId)});
  const entrants = await tx.select({entryId:majorTournamentEntrants.competitionEntryId}).from(majorTournamentEntrants).where(eq(majorTournamentEntrants.seasonId,seasonId));
  const qualification = await tx.query.competitionQualificationRuns.findFirst({where:eq(competitionQualificationRuns.seasonId,seasonId),columns:{completedAt:true}});
  const capacity = resolveManagedMajorProfile({stagePlan:season.stagePlan})?.entrantCapacity;
  const entrantsReady = Boolean(capacity && entrants.length === capacity && (!qualification || qualification.completedAt));
  const entryIds = entrantsReady ? entrants.map(e=>e.entryId).sort() : [];
  const rosterStates = entryIds.length ? await tx.select({entryId:eventRosters.entryId,status:eventRosters.status}).from(eventRosters).where(inArray(eventRosters.entryId,entryIds)) : [];
  const rostersReady = Boolean(prestart?.entrantsLockedAt && entryIds.length && rosterStates.length === entryIds.length && rosterStates.every(r=>r.status === "frozen"));

  const players = [...new Map(roster.filter(r=>rostersReady && r.current && entryIds.includes(r.entryId)).map(r=>[r.userId,{id:r.userId,name:getDisplayName({displayName:r.name,perfectName:r.perfectName,personaName:r.personaName})}])).values()].sort((a,b)=>a.id.localeCompare(b.id));
  const final = await tx.query.majorFinalResults.findFirst({where:eq(majorFinalResults.seasonId,seasonId)});
  const eventMatches = official.filter(m=>m.majorStageRunId && m.entryRound !== "third_place" && !m.isForfeit && m.status !== "cancelled");
  const eventMaps = maps.filter(map=>eventMatches.some(m=>m.id===map.matchId) && map.completedAt);
  const stats = eventMaps.length ? await tx.select({mapId:matchPlayerStats.mapId,userId:matchPlayerStats.userId,kills:matchPlayerStats.kills}).from(matchPlayerStats).innerJoin(matchDemoImports,eq(matchDemoImports.id,matchPlayerStats.dakImportId)).where(and(eq(matchDemoImports.seasonId,seasonId),eq(matchDemoImports.status,"confirmed"),isNotNull(matchPlayerStats.verifiedAt),isNotNull(matchPlayerStats.userId),isNotNull(matchPlayerStats.kills),inArray(matchPlayerStats.mapId,eventMaps.map(map=>map.id)))) : [];
  const completeStats = eventMaps.length > 0 && eventMaps.every(map=>{
    const rows = stats.filter(s=>s.mapId===map.id);
    return rows.length===10 && new Set(rows.map(s=>s.userId)).size===10 && rows.every(s=>players.some(p=>p.id===s.userId));
  });
  const totals = new Map<string,number>();
  if (completeStats) for (const s of stats.filter(s=>eventMaps.some(m=>m.id===s.mapId))) totals.set(s.userId!, (totals.get(s.userId!)??0)+s.kills!);
  const event: EventFact = {entryIds,playerIds:players.map(p=>p.id),started:official.some(m=>m.majorStageRunId && (m.startedAt || m.status==="finished" || vetoByMatch.get(m.id)?.startedAt)),champion:final?.status==="confirmed"?final.championEntryId:null,kills:completeStats?[...totals].sort(([a],[b])=>a.localeCompare(b)).map(([userId,kills])=>({userId,kills})):null};
  return {season,official,maps,vetoByMatch,entries,roster,players,event,eventPublication:{entrantsReady,rostersReady,seedsConfirmed:Boolean(prestart?.seedsConfirmedAt)}};
}
export type BetFacts = Awaited<ReturnType<typeof loadBetFacts>>;

/** Public support needs subjects and frozen pools, not operational or private facts. */
export async function loadBetPublicSupportFacts(tx: TxDb, seasonId: string, matchId?: string) {
  const [season] = await tx.select({registrationConfig: seasons.registrationConfig}).from(seasons).where(eq(seasons.id,seasonId));
  if (!season) throw new AppError(ErrorCode.NOT_FOUND,"赛事不存在");
  const condition = and(officialMatchCondition(),eq(matches.seasonId,seasonId),matchId ? eq(matches.id,matchId) : undefined);
  const official = await tx.select({id:matches.id,seasonId:matches.seasonId,stage:matches.stage,entryAId:matches.entryAId,entryBId:matches.entryBId,majorStageRunId:matches.majorStageRunId,qualificationRunId:matches.qualificationRunId,format:matches.format,status:matches.status,isForfeit:matches.isForfeit}).from(matches).where(condition).orderBy(asc(matches.createdAt)).then(rows=>rows.map(requireCompetitionMatch));
  const vetos = await tx.select({matchId:matchVetoSessions.matchId,mapPoolSnapshot:matchVetoSessions.mapPoolSnapshot}).from(matchVetoSessions).innerJoin(matches,eq(matches.id,matchVetoSessions.matchId)).where(condition);
  return {season,official,vetoByMatch:new Map(vetos.map(v=>[v.matchId,{mapPoolSnapshot:v.mapPoolSnapshot}]))};
}
export type BetPublicSupportFacts = Awaited<ReturnType<typeof loadBetPublicSupportFacts>>;
