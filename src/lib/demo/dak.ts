import { buildSeasonCohort, type PlayerIdentityMap } from "@cs2dak/cohort";
import type {
  AnalysisBundle,
  DemoPackage,
  MatchWorkspaceModel,
  SeasonCohortBundle,
  SeasonLeaderboardModel,
} from "@cs2dak/contract";
import { analyzeDemoPackage, normalizeDemoPackage } from "@cs2dak/core";
import { buildMatchWorkspaceModel, buildSeasonLeaderboardModel } from "@cs2dak/presentation";

interface ParsedDemoPackage {
  manifest: unknown;
  files: Record<string, unknown>;
}

interface MappedPlayer {
  steamId64: string;
  name: string;
  userId: string | null;
}

export interface DakMatchArtifacts {
  pkg: DemoPackage;
  analysis: AnalysisBundle;
  workspace: MatchWorkspaceModel;
}

export interface DakSeasonArtifacts {
  cohort: SeasonCohortBundle;
  leaderboard: SeasonLeaderboardModel;
}

export function toDakPackage(parsed: ParsedDemoPackage): DemoPackage {
  return normalizeDemoPackage({ manifest: parsed.manifest, ...parsed.files });
}

export function buildDakMatchArtifacts(parsed: ParsedDemoPackage): DakMatchArtifacts {
  const pkg = toDakPackage(parsed);
  return buildDakMatchArtifactsFromPackage(pkg);
}

export function buildDakMatchArtifactsFromPackage(pkg: DemoPackage): DakMatchArtifacts {
  return {
    pkg,
    analysis: analyzeDemoPackage(pkg),
    workspace: compactMatchWorkspace(buildMatchWorkspaceModel(pkg)),
  };
}

/**
 * 从 MatchWorkspaceModel 中剥离重放帧，其余全部保留。
 *
 * - 热力图 / 地图点位 / 回合摘要 → 保留，DAK 组件可直接渲染
 * - replay.rounds（逐帧回放数据）→ 清空，由 API Route 从 Storage 按需加载
 *
 * 单地图 DB 体积约 500 KB–3 MB（取决于 map points 密度），
 * 远小于包含逐帧 replay 的完整 workspace（~22 MB）。
 */
export function compactMatchWorkspace(workspace: MatchWorkspaceModel): MatchWorkspaceModel {
  return {
    ...workspace,
    replay: {
      ...workspace.replay,
      available: false,
      sampleRate: null,
      rounds: [],
    },
  };
}

export function buildDakIdentityMap(players: MappedPlayer[]): PlayerIdentityMap {
  return Object.fromEntries(
    players
      .filter((player): player is MappedPlayer & { userId: string } => player.userId !== null)
      .map((player) => [
        player.steamId64,
        {
          playerKey: `user:${player.userId}`,
          userId: player.userId,
          displayName: player.name,
        },
      ]),
  );
}

export function buildDakSeasonArtifacts(
  matches: Array<{ matchId: string; pkg: DemoPackage }>,
  identityMap: PlayerIdentityMap,
): DakSeasonArtifacts {
  const cohort = buildSeasonCohort(matches, { identityMap });
  return {
    cohort,
    leaderboard: buildSeasonLeaderboardModel(cohort),
  };
}
