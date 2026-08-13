// RivalHub 2.0 — 标准 32 队 Major 开赛计划（纯领域预览）。
//
// 本模块只从管理员已确认的赛事种子构造入场批次与 Stage 1 首轮预览；
// 不创建比赛、不写数据库、不改变任何赛事状态。

import {
  seedMajorStageOneEntrants,
  type MajorTournamentSeededTeam,
} from "./seeding";
import {
  generateNextMajorSwissRound,
  type MajorSwissEntrant,
  type MajorSwissMatchFormat,
  type MajorSwissPairingRule,
  type MajorSwissStageMatchFormat,
} from "./swiss";

const MAJOR_TOURNAMENT_TEAM_COUNT = 32;
const DIRECT_STAGE_THREE_COUNT = 8;
const DIRECT_STAGE_TWO_COUNT = 8;

export interface MajorOpeningStageOneEntrant extends MajorTournamentSeededTeam {
  /** Stage 1 内部种子，与赛事级 tournamentSeed 不同。 */
  initialStageSeed: number;
}

export interface MajorOpeningFirstRoundTeam {
  teamId: string;
  tournamentSeed: number;
  stageOneSeed: number;
}

export interface MajorOpeningFirstRoundPairing {
  round: 1;
  higherSeed: MajorOpeningFirstRoundTeam;
  lowerSeed: MajorOpeningFirstRoundTeam;
  format: MajorSwissMatchFormat;
  pairingRule: MajorSwissPairingRule;
}

export interface MajorOpeningPlan {
  /** 按赛事种子 1..32 升序。 */
  tournamentTeams: readonly MajorTournamentSeededTeam[];
  stage1: {
    /** 按赛事种子与 Stage 1 本阶段种子升序：赛事 #17..#32 / Stage 1 #1..#16。 */
    entrants: readonly MajorOpeningStageOneEntrant[];
  };
  stage2: {
    /** 按赛事种子升序：赛事 #9..#16。 */
    directEntrants: readonly MajorTournamentSeededTeam[];
  };
  stage3: {
    /** 按赛事种子升序：赛事 #1..#8。 */
    directEntrants: readonly MajorTournamentSeededTeam[];
  };
  firstRound: {
    pairings: readonly MajorOpeningFirstRoundPairing[];
  };
}

function normalizeTournamentTeams(
  teams: readonly MajorTournamentSeededTeam[],
): readonly MajorTournamentSeededTeam[] {
  if (teams.length !== MAJOR_TOURNAMENT_TEAM_COUNT) {
    throw new Error(
      `Major opening requires exactly ${MAJOR_TOURNAMENT_TEAM_COUNT} teams (got ${teams.length})`,
    );
  }

  const teamIds = new Set<string>();
  const tournamentSeeds = new Set<number>();
  for (const team of teams) {
    if (typeof team.teamId !== "string" || team.teamId.length === 0) {
      throw new Error("tournament teamId must be a non-empty string");
    }
    if (teamIds.has(team.teamId)) {
      throw new Error(`duplicate tournament teamId: ${team.teamId}`);
    }
    teamIds.add(team.teamId);

    if (
      !Number.isInteger(team.tournamentSeed) ||
      team.tournamentSeed < 1 ||
      team.tournamentSeed > MAJOR_TOURNAMENT_TEAM_COUNT
    ) {
      throw new Error(
        `invalid tournamentSeed ${team.tournamentSeed}: must be an integer in 1..${MAJOR_TOURNAMENT_TEAM_COUNT}`,
      );
    }
    if (tournamentSeeds.has(team.tournamentSeed)) {
      throw new Error(`duplicate tournamentSeed: ${team.tournamentSeed}`);
    }
    tournamentSeeds.add(team.tournamentSeed);
  }

  for (let seed = 1; seed <= MAJOR_TOURNAMENT_TEAM_COUNT; seed += 1) {
    if (!tournamentSeeds.has(seed)) {
      throw new Error(
        `tournamentSeed set must be exactly 1..${MAJOR_TOURNAMENT_TEAM_COUNT}; missing ${seed}`,
      );
    }
  }

  return [...teams]
    .map((team) => ({ ...team }))
    .sort((a, b) => a.tournamentSeed - b.tournamentSeed);
}

function buildStageOneEntrants(
  tournamentTeams: readonly MajorTournamentSeededTeam[],
): readonly MajorOpeningStageOneEntrant[] {
  const stageOneTournamentTeams = tournamentTeams.slice(
    DIRECT_STAGE_THREE_COUNT + DIRECT_STAGE_TWO_COUNT,
  );
  const stageOneSeeds = seedMajorStageOneEntrants(stageOneTournamentTeams);
  const tournamentTeamById = new Map(tournamentTeams.map((team) => [team.teamId, team]));

  return stageOneSeeds.map((entrant) => ({
    ...tournamentTeamById.get(entrant.teamId)!,
    initialStageSeed: entrant.initialStageSeed,
  }));
}

function buildFirstRoundPreview(
  stageOneEntrants: readonly MajorOpeningStageOneEntrant[],
  stageOneMatchFormat: MajorSwissStageMatchFormat,
): readonly MajorOpeningFirstRoundPairing[] {
  const swissEntrants: readonly MajorSwissEntrant[] = stageOneEntrants.map((entrant) => ({
    teamId: entrant.teamId,
    initialStageSeed: entrant.initialStageSeed,
  }));
  const entrantById = new Map(stageOneEntrants.map((entrant) => [entrant.teamId, entrant]));

  return generateNextMajorSwissRound({
    entrants: swissEntrants,
    matches: [],
    finalizedRound: 0,
    stageMatchFormat: stageOneMatchFormat,
  }).map((pairing) => {
    const higher = entrantById.get(pairing.higherSeedTeamId)!;
    const lower = entrantById.get(pairing.lowerSeedTeamId)!;
    return {
      // 此调用固定传入 finalizedRound: 0，因此底层生成的只能是 R1。
      round: 1,
      higherSeed: {
        teamId: higher.teamId,
        tournamentSeed: higher.tournamentSeed,
        stageOneSeed: higher.initialStageSeed,
      },
      lowerSeed: {
        teamId: lower.teamId,
        tournamentSeed: lower.tournamentSeed,
        stageOneSeed: lower.initialStageSeed,
      },
      format: pairing.format,
      pairingRule: pairing.pairingRule,
    };
  });
}

/**
 * 构造标准 32 队 Major 的开赛预览。
 *
 * 输入必须是赛事级种子精确为 1..32 的完整队伍集合；本函数不会修复缺号、
 * 重号或越界种子。Stage 1 BO5 由底层 Major Swiss 核心明确拒绝。
 */
export function buildMajorOpeningPlan(input: {
  teams: readonly MajorTournamentSeededTeam[];
  stageOneMatchFormat: MajorSwissStageMatchFormat;
}): MajorOpeningPlan {
  const tournamentTeams = normalizeTournamentTeams(input.teams);
  const stageOneEntrants = buildStageOneEntrants(tournamentTeams);

  return {
    tournamentTeams,
    stage1: { entrants: stageOneEntrants },
    stage2: {
      directEntrants: tournamentTeams.slice(
        DIRECT_STAGE_THREE_COUNT,
        DIRECT_STAGE_THREE_COUNT + DIRECT_STAGE_TWO_COUNT,
      ),
    },
    stage3: {
      directEntrants: tournamentTeams.slice(0, DIRECT_STAGE_THREE_COUNT),
    },
    firstRound: {
      pairings: buildFirstRoundPreview(stageOneEntrants, input.stageOneMatchFormat),
    },
  };
}
