import "server-only";
import { and, eq, inArray, isNotNull, asc } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { seasons, matches, matchMaps, matchVetoSessions, matchVetoAppeals, matchVetoTimeoutIncidents, competitionEntries, majorFinalResults, majorPrestartStates, majorTournamentEntrants, majorTournamentSeeds, eventRosterMembers, eventRosters, users, steamProfiles, matchPlayerStats, matchDemoImports, majorStageRuns } from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";
import { getDisplayName } from "@/lib/identity/display-name";
import type { EventFact, VetoFact } from "./domain";
export async function loadBetFacts(tx: TxDb,seasonId: string) {
  const season = await tx.query.seasons.findFirst({where:eq(seasons.id,seasonId)});
  if (!season) throw new AppError(ErrorCode.NOT_FOUND,"赛事不存在");
  const officialRows = await tx.select().from(matches).where(eq(matches.seasonId,seasonId)).orderBy(asc(matches.createdAt)).then(rows=>rows.map(m=>({...m,operationalStartedAt:m.startedAt,startedAt:m.gameplayStartedAt})));
  const maps = await tx.select({map:matchMaps}).from(matchMaps).innerJoin(matches,eq(matches.id,matchMaps.matchId)).where(eq(matches.seasonId,seasonId)).then(rows=>rows.map(r=>r.map));
  // Canonical map facts also prove gameplay when the separate start marker is absent.
  const official = officialRows.map(m => ({...m,startedAt:m.startedAt ?? maps
    .filter(map=>map.matchId===m.id && (map.startedAt || map.completedAt))
    .map(map=>map.startedAt ?? map.completedAt!)
    .sort((a,b)=>a.getTime()-b.getTime())[0] ?? null}));
  const vetos = await tx.select().from(matchVetoSessions).innerJoin(matches,eq(matches.id,matchVetoSessions.matchId)).where(eq(matches.seasonId,seasonId)).then(rows=>rows.map(r=>r.match_veto_sessions));
  const appeals = await tx.select({matchId:matchVetoTimeoutIncidents.matchId}).from(matchVetoAppeals).innerJoin(matchVetoTimeoutIncidents,eq(matchVetoTimeoutIncidents.id,matchVetoAppeals.timeoutIncidentId)).innerJoin(matches,eq(matches.id,matchVetoTimeoutIncidents.matchId)).where(and(eq(matches.seasonId,seasonId),eq(matchVetoAppeals.status,"pending")));
  const vetoByMatch = new Map<string,VetoFact>(vetos.map(v=>[v.matchId,{...v,pendingAppeal:appeals.some(a=>a.matchId===v.matchId)}]));
  const entries = await tx.select({id:competitionEntries.id,name:competitionEntries.name,logoUrl:competitionEntries.logoUrl}).from(competitionEntries).where(eq(competitionEntries.competitionId,seasonId));
  const prestart = await tx.query.majorPrestartStates.findFirst({where:eq(majorPrestartStates.seasonId,seasonId)});
  const entrants = prestart?.seedsConfirmedAt ? await tx.select({entryId:majorTournamentEntrants.competitionEntryId}).from(majorTournamentSeeds).innerJoin(majorTournamentEntrants,eq(majorTournamentEntrants.id,majorTournamentSeeds.tournamentEntrantId)).where(eq(majorTournamentSeeds.seasonId,seasonId)) : [];
  const entryIds = entrants.map(e=>e.entryId).sort();
  const roster = await tx.select({entryId:eventRosters.entryId,userId:eventRosterMembers.userId,name:users.displayName,perfectName:users.perfectName,personaName:steamProfiles.personaName,current:eventRosterMembers.isCurrent}).from(eventRosterMembers).innerJoin(eventRosters,eq(eventRosters.id,eventRosterMembers.eventRosterId)).innerJoin(competitionEntries,eq(competitionEntries.id,eventRosters.entryId)).innerJoin(users,eq(users.id,eventRosterMembers.userId)).leftJoin(steamProfiles,eq(steamProfiles.steam64,users.steam64)).where(and(eq(competitionEntries.competitionId,seasonId),inArray(eventRosters.status,["confirmed","frozen"])));
  const players = [...new Map(roster.filter(r=>r.current && entryIds.includes(r.entryId)).map(r=>[r.userId,{id:r.userId,name:getDisplayName({displayName:r.name,perfectName:r.perfectName,personaName:r.personaName})}])).values()].sort((a,b)=>a.id.localeCompare(b.id));
  const final = await tx.query.majorFinalResults.findFirst({where:eq(majorFinalResults.seasonId,seasonId)});
  const stats = await tx.select({mapId:matchPlayerStats.mapId,userId:matchPlayerStats.userId,kills:matchPlayerStats.kills,importId:matchDemoImports.id}).from(matchPlayerStats).innerJoin(matchDemoImports,eq(matchDemoImports.id,matchPlayerStats.dakImportId)).where(and(eq(matchDemoImports.seasonId,seasonId),eq(matchDemoImports.status,"confirmed"),isNotNull(matchPlayerStats.verifiedAt),isNotNull(matchPlayerStats.userId),isNotNull(matchPlayerStats.kills)));
  const eventMatches = official.filter(m=>m.majorStageRunId && m.entryRound !== "third_place" && !m.isForfeit && m.status !== "cancelled");
  const eventMaps = maps.filter(map=>eventMatches.some(m=>m.id===map.matchId) && map.completedAt);
  const completeStats = eventMaps.length > 0 && eventMaps.every(map=>{
    const rows = stats.filter(s=>s.mapId===map.id);
    return rows.length===10 && new Set(rows.map(s=>s.userId)).size===10 && rows.every(s=>players.some(p=>p.id===s.userId));
  });
  const totals = new Map<string,number>();
  if (completeStats) for (const s of stats.filter(s=>eventMaps.some(m=>m.id===s.mapId))) totals.set(s.userId!, (totals.get(s.userId!)??0)+s.kills!);
  const event: EventFact = {entryIds,playerIds:players.map(p=>p.id),started:official.some(m=>m.majorStageRunId && (m.startedAt || m.status==="finished" || vetoByMatch.get(m.id)?.startedAt)),champion:final?.status==="confirmed"?final.championEntryId:null,kills:completeStats?[...totals].sort(([a],[b])=>a.localeCompare(b)).map(([userId,kills])=>({userId,kills})):null};
  const runs = await tx.select().from(majorStageRuns).where(eq(majorStageRuns.seasonId,seasonId)).orderBy(asc(majorStageRuns.startedAt));
  return {season,official,maps,vetoByMatch,entries,roster,players,event,runs};
}
export type BetFacts = Awaited<ReturnType<typeof loadBetFacts>>;
