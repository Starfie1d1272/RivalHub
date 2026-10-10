import "server-only";
import type { Match, MatchMap } from "@/db/schema";
import type { EffectiveMatchRosterPlayer } from "@/lib/match-rosters/effective";
import type { DemoImportMetadata } from "@/lib/demo-integration/metadata";
import { canConfirmMapScoreboard } from "@/lib/matches/map-scoreboard";
import { projectDemoStatus, selectCurrentDemoImport } from "@/lib/demo-integration/read";
import { buildEvidenceRevisionForTarget } from "@/lib/demo-integration/revision";
import { isCompleteScoreboard, type ScoreboardRow } from "@/lib/matches/scoreboard-completeness";
import type { OperatorMap } from "./operator-workflow";

/** Shared by the authorized overview and workbench; no persistence or completion rule duplication. */
export function projectOperatorMaps(input: {
  match: Match; maps: readonly MatchMap[]; imports: readonly DemoImportMetadata[];
  roster: readonly EffectiveMatchRosterPlayer[]; scoreboards: readonly ScoreboardRow[];
}): OperatorMap[] {
  const { match, maps, roster, scoreboards } = input;
  const participants = roster.filter(player => player.isStarter);
  return maps.map(map => {
    const imports = input.imports.filter(row => row.matchMapId === map.id);
    // Surface an incompatible latest import too; it is not a missing upload.
    const current = selectCurrentDemoImport(imports);
    const latest = current ?? imports.find(row => row.status !== "superseded");
    const revision = buildEvidenceRevisionForTarget({ match, map, roster });
    const latestConfirmed = imports.find(row => row.status === "confirmed");
    const confirmedIsStale = latestConfirmed != null && latestConfirmed.evidenceRevision !== revision;
    const demoStatus = confirmedIsStale ? "needs_attention" : projectDemoStatus(match, map, latest, revision);
    return {
      id: map.id, order: map.mapOrder, name: map.mapName, startSide: map.teamAStartSide,
      completedAt: canConfirmMapScoreboard(map) ? map.completedAt!.toISOString() : null,
      scoreboardComplete: isCompleteScoreboard({ matchId: match.id, mapId: map.id, scoreA: map.scoreA, scoreB: map.scoreB, participants }, scoreboards.filter(row => row.mapId === map.id)),
      demoLabel: demoStatus === "synced" ? "已同步" : demoStatus === "demo_processing" ? "处理中" : demoStatus === "needs_attention" ? latest?.status === "rejected" ? "导入失败 / 已驳回" : latest?.status === "needs_attention" ? "待审核" : "需要处理" : "待上传",
      demoNeedsAttention: demoStatus === "needs_attention",
      demoComplete: demoStatus === "synced",
      demoReviewAnchor: current?.status === "needs_attention" ? `demo-review-${map.id}` : undefined,
    };
  });
}
