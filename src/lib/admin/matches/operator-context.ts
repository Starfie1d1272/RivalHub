import "server-only";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { competitionQualificationRuns, matchLiveSessions, matchPlayerStats as playerStats, type Match, type MatchMap } from "@/db/schema";
import type { EffectiveMatchRosterPlayer } from "@/lib/match-rosters/effective";
import { canConfirmMapScoreboard } from "@/lib/matches/map-scoreboard";
import { loadMajorSwissStageReadModel } from "@/lib/matches/stage-read-model";
import { loadQualificationSwissStageReadModel } from "@/lib/matches/qualification-stage-read-model";
import { projectDemoStatus, selectCurrentDemoImport } from "@/lib/demo-integration/read";
import type { DemoImportMetadata } from "@/lib/demo-integration/metadata";
import { buildEvidenceRevisionForTarget } from "@/lib/demo-integration/revision";
import { isCompleteScoreboard } from "@/lib/matches/scoreboard-completeness";
import { mapLabel } from "@/lib/maps";
import { loadOperatorEvidence } from "./operator-evidence";
import { buildPerfectRoomGuide, projectOperatorWorkflow } from "./operator-workflow";

/** Called only after the workbench has authorized this match's season. */
export async function loadOperatorContext(input: {
  match: Match;
  maps: MatchMap[];
  imports: DemoImportMetadata[];
  roster: EffectiveMatchRosterPlayer[];
  seasonName: string;
  stageName: string | null;
  isSwiss: boolean;
  teamAName: string;
  teamBName: string;
  vetoComplete: boolean;
}) {
  const { match, maps, roster } = input;
  const [scoreboards, liveSession, swiss, qualification] = await Promise.all([
    maps.length ? db.select()
      .from(playerStats).where(inArray(playerStats.mapId, maps.map(map => map.id))) : Promise.resolve([]),
    db.query.matchLiveSessions.findFirst({
      where: and(eq(matchLiveSessions.matchId, match.id), isNull(matchLiveSessions.closedAt)),
      columns: { id: true, authorityRevision: true, programSourceGeneration: true, lastReliableSeq: true, currentMapId: true, mapExecutionPhase: true, mapEpoch: true, manualTakeoverMapEpoch: true, identityHealth: true, lineupHealth: true, continuityHealth: true, autoCanonicalizationArmed: true },
    }),
    match.qualificationRunId ? loadQualificationSwissStageReadModel(match.seasonId)
      : input.isSwiss && match.ownership === "major_stage"
        ? loadMajorSwissStageReadModel(match.seasonId, match.stage) : Promise.resolve(null),
    match.qualificationRunId ? db.query.competitionQualificationRuns.findFirst({ where: and(eq(competitionQualificationRuns.id, match.qualificationRunId), eq(competitionQualificationRuns.seasonId, match.seasonId)), columns: { format: true } }) : Promise.resolve(null),
  ]);
  const participants = roster.filter(player => player.isStarter);
  const operatorMaps = maps.map(map => {
    const imports = input.imports.filter(row => row.matchMapId === map.id);
    // Surface an incompatible latest import too; it is not a missing upload.
    const latest = selectCurrentDemoImport(imports) ?? imports.find(row => row.status !== "superseded");
    const revision = buildEvidenceRevisionForTarget({ match, map, roster });
    const latestConfirmed = imports.find(row => row.status === "confirmed");
    const confirmedIsStale = latestConfirmed != null && latestConfirmed.evidenceRevision !== revision;
    const demoStatus = confirmedIsStale ? "needs_attention" : projectDemoStatus(match, map, latest, revision);
    return {
      id: map.id, order: map.mapOrder, name: map.mapName, startSide: map.teamAStartSide,
      completedAt: canConfirmMapScoreboard(map) ? map.completedAt!.toISOString() : null,
      scoreboardComplete: isCompleteScoreboard({ matchId: match.id, mapId: map.id, scoreA: map.scoreA, scoreB: map.scoreB, participants }, scoreboards.filter(row => row.mapId === map.id)),
      demoLabel: demoStatus === "synced" ? "已同步" : demoStatus === "demo_processing" ? "处理中" : demoStatus === "needs_attention" ? "需要处理" : "待上传",
      demoNeedsAttention: demoStatus === "needs_attention",
      demoComplete: demoStatus === "synced",
    };
  });
  const workflow = projectOperatorWorkflow({
    source: liveSession,
    scheduledAt: match.scheduledAt?.toISOString(), startedAt: match.startedAt?.toISOString(), completedAt: match.completedAt?.toISOString(),
    status: match.status, isForfeit: match.isForfeit, vetoComplete: input.vetoComplete,
    maps: operatorMaps,
    observedGameplayMapId: liveSession?.mapExecutionPhase === "gameplay" ? liveSession.currentMapId : null,
  });
  const roomMap = operatorMaps.find(map => map.id === workflow.roomMapId);
  const record = swiss?.rounds.flatMap(round => round.groups).find(group => group.matchups.some(row => row.matchId === match.id))?.record;
  const playoffLabel: Record<string, string> = { quarterfinal: "四分之一决赛", semifinal: "半决赛", third_place: "季军赛", final: "决赛" };
  const description = input.isSwiss || (match.qualificationRunId && qualification?.format !== "direct_bo3") ? (record && !record.includes("待定") ? record.replaceAll(":", "-") : null)
    : match.entryRound ? playoffLabel[match.entryRound] ?? null : match.round !== null ? `第 ${match.round} 轮` : null;
  const roundLabel = ({ stage1: "Stage1", stage2: "Stage2", stage3: "Stage3" } as Record<string, string>)[match.stage] ?? swiss?.stageName ?? (qualification?.format === "direct_bo3" ? "Play-in" : input.stageName);
  const recoveryMap = input.vetoComplete && liveSession && liveSession.currentMapId === null && !liveSession.autoCanonicalizationArmed && ["execution_conflict", "conflict"].includes(liveSession.continuityHealth)
    ? [...maps].sort((a, b) => a.mapOrder - b.mapOrder).find(map => map.completedAt === null) : null;
  const takeoverMap = maps.find(map => map.id === liveSession?.currentMapId && map.completedAt === null) ?? recoveryMap;
  const currentMap = maps.find(map => map.id === liveSession?.currentMapId);
  const evidence = liveSession && workflow.reviewReasons.length
    ? await loadOperatorEvidence(match.seasonId, match.id, liveSession.id, liveSession.mapEpoch,
      currentMap && workflow.reviewReasons.includes("execution_mismatch") ? { id: currentMap.id, name: currentMap.mapName } : undefined)
    : null;
  const reportedMap = maps.find(map => map.id === evidence?.mapId);
  const mapBinding = !evidence?.mapId ? "未提供地图绑定"
    : reportedMap ? `Map ${reportedMap.mapOrder} · ${mapLabel(reportedMap.mapName)}` : "不属于本场正式地图";
  const nextMap = [...maps].sort((a, b) => a.mapOrder - b.mapOrder).find(map => map.completedAt === null);
  const problemRecovery = input.vetoComplete && match.status === "in_progress" && liveSession && nextMap
    && (liveSession.currentMapId === null || liveSession.currentMapId === nextMap.id)
    && !(workflow.sourceMode === "manual_map" && liveSession.currentMapId === nextMap.id)
    ? { sessionId: liveSession.id, mapEpoch: liveSession.mapEpoch, mapId: nextMap.id,
      recoverMapBinding: liveSession.currentMapId === null,
      reportContext: { programSourceGeneration: liveSession.programSourceGeneration, lastReliableSeq: liveSession.lastReliableSeq, currentMapId: liveSession.currentMapId },
      mapLabel: `Map ${nextMap.mapOrder} · ${mapLabel(nextMap.mapName)}` } : null;
  return {
    problemRecovery,
    liveScope: liveSession && match.status === "in_progress" ? {
      authorityRevision: liveSession.authorityRevision, generation: liveSession.programSourceGeneration,
      epoch: liveSession.mapEpoch, mapId: liveSession.currentMapId,
    } : null,
    review: {
      evidence: evidence ? { at: evidence.at, lineupDifference: evidence.lineupDifference, mapName: evidence.mapName, scoreA: evidence.scoreA, scoreB: evidence.scoreB, mapBinding } : null,
      expectedTeams: `${input.teamAName} vs ${input.teamBName}`,
      currentMap: currentMap ? `Map ${currentMap.mapOrder} · ${mapLabel(currentMap.mapName)}` : null,
      officialScore: currentMap?.completedAt ? `${currentMap.scoreA}:${currentMap.scoreB}` : null,
    },
    workflow,
    recoveryMapLabel: recoveryMap ? `Map ${recoveryMap.mapOrder} · ${mapLabel(recoveryMap.mapName)}` : null,
    takeover: liveSession && takeoverMap && (workflow.sourceMode !== "manual_map" || recoveryMap != null) && (workflow.reviewReasons.length > 0 || workflow.sourceHealth === "stale") && match.status === "in_progress" ? { sessionId: liveSession.id, mapEpoch: liveSession.mapEpoch, mapId: takeoverMap.id, ...(recoveryMap ? { recoverMapBinding: true } : {}) } : null,
    roomGuide: roomMap ? buildPerfectRoomGuide({
      seasonName: input.seasonName, roundLabel, description,
      teamAName: input.teamAName, teamBName: input.teamBName, map: roomMap,
    }) : null,
  };
}
