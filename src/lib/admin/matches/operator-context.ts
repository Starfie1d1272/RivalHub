import "server-only";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { matchLiveSessions, matchPlayerStats as playerStats, type Match, type MatchMap, type MatchDemoImport } from "@/db/schema";
import type { EffectiveMatchRosterPlayer } from "@/lib/match-rosters/effective";
import { canConfirmMapScoreboard } from "@/lib/matches/map-scoreboard";
import { loadMajorSwissStageReadModel } from "@/lib/matches/stage-read-model";
import { loadQualificationSwissStageReadModel } from "@/lib/matches/qualification-stage-read-model";
import { projectDemoStatus, selectCurrentDemoImport } from "@/lib/demo-integration/read";
import { buildEvidenceRevisionForTarget } from "@/lib/demo-integration/revision";
import { buildPerfectRoomGuide, isOperatorScoreboardComplete, projectOperatorWorkflow } from "./operator-workflow";

/** Called only after the workbench has authorized this match's season. */
export async function loadOperatorContext(input: {
  match: Match;
  maps: MatchMap[];
  imports: MatchDemoImport[];
  roster: EffectiveMatchRosterPlayer[];
  seasonName: string;
  stageName: string | null;
  isSwiss: boolean;
  teamAName: string;
  teamBName: string;
  vetoComplete: boolean;
}) {
  const { match, maps, roster } = input;
  const [scoreboards, liveSession, swiss] = await Promise.all([
    maps.length ? db.select({ mapId: playerStats.mapId, userId: playerStats.userId, ratingPro: playerStats.ratingPro, rws: playerStats.rws, we: playerStats.we })
      .from(playerStats).where(inArray(playerStats.mapId, maps.map(map => map.id))) : Promise.resolve([]),
    db.query.matchLiveSessions.findFirst({
      where: and(eq(matchLiveSessions.matchId, match.id), isNull(matchLiveSessions.closedAt)),
      columns: { currentMapId: true, mapExecutionPhase: true },
    }),
    match.qualificationRunId ? loadQualificationSwissStageReadModel(match.seasonId)
      : input.isSwiss && match.ownership === "major_stage"
        ? loadMajorSwissStageReadModel(match.seasonId, match.stage) : Promise.resolve(null),
  ]);
  const starterIds = roster.filter(player => player.isStarter).map(player => player.userId);
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
      scoreboardComplete: isOperatorScoreboardComplete(starterIds, scoreboards.filter(row => row.mapId === map.id)),
      demoLabel: demoStatus === "synced" ? "已同步" : demoStatus === "demo_processing" ? "处理中" : demoStatus === "needs_attention" ? "需要处理" : "待上传",
      demoNeedsAttention: demoStatus === "needs_attention",
    };
  });
  const workflow = projectOperatorWorkflow({
    status: match.status, isForfeit: match.isForfeit, vetoComplete: input.vetoComplete,
    maps: operatorMaps,
    observedGameplayMapId: liveSession?.mapExecutionPhase === "gameplay" ? liveSession.currentMapId : null,
  });
  const roomMap = operatorMaps.find(map => map.id === workflow.roomMapId);
  const record = swiss?.rounds.flatMap(round => round.groups).find(group => group.matchups.some(row => row.matchId === match.id))?.record;
  const playoffLabel: Record<string, string> = { quarterfinal: "四分之一决赛", semifinal: "半决赛", third_place: "季军赛", final: "决赛" };
  const description = input.isSwiss || match.qualificationRunId ? (record && !record.includes("待定") ? record.replaceAll(":", "-") : null)
    : match.entryRound ? playoffLabel[match.entryRound] ?? null : match.round !== null ? `第 ${match.round} 轮` : null;
  const roundLabel = ({ stage1: "Stage1", stage2: "Stage2", stage3: "Stage3" } as Record<string, string>)[match.stage] ?? swiss?.stageName ?? input.stageName;
  return {
    workflow,
    roomGuide: roomMap ? buildPerfectRoomGuide({
      seasonName: input.seasonName, roundLabel, description,
      teamAName: input.teamAName, teamBName: input.teamBName, map: roomMap,
    }) : null,
  };
}
