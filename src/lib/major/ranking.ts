import type { MajorTournamentSeededTeam } from "./seeding";
import {
  getMajorSwissQualifiers,
  projectMajorSwissStage,
  type MajorSwissEntrant,
  type MajorSwissMatchFact,
  type MajorSwissTeamState,
} from "./swiss";
import {
  projectMajorPlayoff,
  seedMajorPlayoffEntrants,
  type MajorPlayoffMatchFact,
} from "./playoff";

export interface MajorSwissStageFacts {
  entrants: readonly MajorSwissEntrant[];
  matches: readonly MajorSwissMatchFact[];
}

export type MajorFinalPlacement = "1st" | "2nd" | "3rd" | "5th" | null;

export type MajorEliminationStage = "playoff" | "stage3" | "stage2" | "stage1";

export interface MajorFinalRankingRow {
  rank: number;
  teamId: string;
  playoffPlacement: MajorFinalPlacement;
  eliminationStage: MajorEliminationStage;
  tournamentSeed: number;
}

interface StageProjections {
  stage1: ReturnType<typeof projectMajorSwissStage>;
  stage2: ReturnType<typeof projectMajorSwissStage>;
  stage3: ReturnType<typeof projectMajorSwissStage>;
}

function setOf(items: readonly { teamId: string }[]): Set<string> {
  return new Set(items.map((item) => item.teamId));
}

function assertSameSet(actual: ReadonlySet<string>, expected: ReadonlySet<string>, label: string): void {
  if (actual.size !== expected.size || [...actual].some((teamId) => !expected.has(teamId))) {
    throw new Error(`${label} does not match the required team set`);
  }
}

function indexTournamentTeams(
  teams: readonly MajorTournamentSeededTeam[],
): Map<string, MajorTournamentSeededTeam> {
  if (teams.length !== 32) {
    throw new Error(`Major final ranking requires exactly 32 teams (got ${teams.length})`);
  }

  const byId = new Map<string, MajorTournamentSeededTeam>();
  const seeds = new Set<number>();
  for (const team of teams) {
    if (typeof team.teamId !== "string" || team.teamId.length === 0) {
      throw new Error("tournament teamId must be a non-empty string");
    }
    if (byId.has(team.teamId)) {
      throw new Error(`duplicate tournament teamId: ${team.teamId}`);
    }
    if (!Number.isInteger(team.tournamentSeed) || team.tournamentSeed <= 0) {
      throw new Error(`invalid tournamentSeed ${team.tournamentSeed}: must be a positive integer`);
    }
    if (seeds.has(team.tournamentSeed)) {
      throw new Error(`duplicate tournamentSeed: ${team.tournamentSeed}`);
    }
    byId.set(team.teamId, team);
    seeds.add(team.tournamentSeed);
  }
  return byId;
}

function projectCompleteStage(facts: MajorSwissStageFacts, label: string) {
  const projection = projectMajorSwissStage({
    entrants: facts.entrants,
    matches: facts.matches,
    finalizedRound: 5,
  });
  if (!projection.isComplete || projection.advanced.length !== 8 || projection.eliminated.length !== 8) {
    throw new Error(`${label} must be a complete 8-advance / 8-eliminate Swiss stage`);
  }
  return projection;
}

function validateProgression(
  tournamentTeamIds: ReadonlySet<string>,
  projections: StageProjections,
): void {
  const stage1 = setOf(projections.stage1.teams);
  const stage2 = setOf(projections.stage2.teams);
  const stage3 = setOf(projections.stage3.teams);

  for (const [label, stage] of [
    ["Stage 1", stage1],
    ["Stage 2", stage2],
    ["Stage 3", stage3],
  ] as const) {
    for (const teamId of stage) {
      if (!tournamentTeamIds.has(teamId)) {
        throw new Error(`${label} contains team outside the 32 tournament teams: ${teamId}`);
      }
    }
  }

  const stage1Advanced = setOf(projections.stage1.advanced);
  const stage2FromStage1 = new Set([...stage2].filter((teamId) => stage1.has(teamId)));
  assertSameSet(stage2FromStage1, stage1Advanced, "Stage 2 advancing entrants");

  const stage2Advanced = setOf(projections.stage2.advanced);
  const stage3FromStage2 = new Set([...stage3].filter((teamId) => stage2.has(teamId)));
  assertSameSet(stage3FromStage2, stage2Advanced, "Stage 3 advancing entrants");

  // 16 Stage 1 direct + 8 Stage 2 direct + 8 Stage 3 direct must cover exactly 32 teams.
  const entryCohorts = new Set(stage1);
  for (const teamId of stage2) {
    if (!stage1Advanced.has(teamId)) {
      if (entryCohorts.has(teamId)) {
        throw new Error(`team ${teamId} appears in more than one direct-entry cohort`);
      }
      entryCohorts.add(teamId);
    }
  }
  for (const teamId of stage3) {
    if (!stage2Advanced.has(teamId)) {
      if (entryCohorts.has(teamId)) {
        throw new Error(`team ${teamId} appears in more than one direct-entry cohort`);
      }
      entryCohorts.add(teamId);
    }
  }
  assertSameSet(entryCohorts, tournamentTeamIds, "Major direct-entry cohorts");
}

function indexStageStates(projection: ReturnType<typeof projectMajorSwissStage>) {
  return new Map(projection.teams.map((team) => [team.teamId, team]));
}

function compareRecordAndDifficulty(
  a: MajorSwissTeamState | undefined,
  b: MajorSwissTeamState | undefined,
): number {
  // A team that entered later has no earlier-stage result. Treat that missing criterion as
  // the neutral 0-0 / difficulty 0 value, then continue through Valve's ordered tie-breaks.
  const aWins = a?.wins ?? 0;
  const bWins = b?.wins ?? 0;
  const aLosses = a?.losses ?? 0;
  const bLosses = b?.losses ?? 0;
  const aDifficulty = a?.difficultyScore ?? 0;
  const bDifficulty = b?.difficultyScore ?? 0;
  return bWins - aWins || aLosses - bLosses || bDifficulty - aDifficulty;
}

function buildTieBreaker(
  teamsById: ReadonlyMap<string, MajorTournamentSeededTeam>,
  projections: StageProjections,
): (teamAId: string, teamBId: string) => number {
  const stage3 = indexStageStates(projections.stage3);
  const stage2 = indexStageStates(projections.stage2);
  const stage1 = indexStageStates(projections.stage1);

  return (teamAId, teamBId) =>
    compareRecordAndDifficulty(stage3.get(teamAId), stage3.get(teamBId)) ||
    compareRecordAndDifficulty(stage2.get(teamAId), stage2.get(teamBId)) ||
    compareRecordAndDifficulty(stage1.get(teamAId), stage1.get(teamBId)) ||
    teamsById.get(teamAId)!.tournamentSeed - teamsById.get(teamBId)!.tournamentSeed;
}

export function buildFinalMajorRanking(input: {
  tournamentTeams: readonly MajorTournamentSeededTeam[];
  stage1: MajorSwissStageFacts;
  stage2: MajorSwissStageFacts;
  stage3: MajorSwissStageFacts;
  playoffMatches: readonly MajorPlayoffMatchFact[];
}): readonly MajorFinalRankingRow[] {
  const teamsById = indexTournamentTeams(input.tournamentTeams);
  const projections: StageProjections = {
    stage1: projectCompleteStage(input.stage1, "Stage 1"),
    stage2: projectCompleteStage(input.stage2, "Stage 2"),
    stage3: projectCompleteStage(input.stage3, "Stage 3"),
  };
  validateProgression(new Set(teamsById.keys()), projections);

  const stage3Qualifiers = getMajorSwissQualifiers(projections.stage3);
  const playoff = projectMajorPlayoff({
    entrants: seedMajorPlayoffEntrants(stage3Qualifiers),
    matches: input.playoffMatches,
  });
  const compareTeams = buildTieBreaker(teamsById, projections);

  const groups: readonly {
    teamIds: readonly string[];
    playoffPlacement: MajorFinalPlacement;
    eliminationStage: MajorEliminationStage;
  }[] = [
    { teamIds: [playoff.championId], playoffPlacement: "1st", eliminationStage: "playoff" },
    { teamIds: [playoff.runnerUpId], playoffPlacement: "2nd", eliminationStage: "playoff" },
    {
      teamIds: [...playoff.semifinalLoserIds].sort(compareTeams),
      playoffPlacement: "3rd",
      eliminationStage: "playoff",
    },
    {
      teamIds: [...playoff.quarterfinalLoserIds].sort(compareTeams),
      playoffPlacement: "5th",
      eliminationStage: "playoff",
    },
    {
      teamIds: projections.stage3.eliminated.map((team) => team.teamId).sort(compareTeams),
      playoffPlacement: null,
      eliminationStage: "stage3",
    },
    {
      teamIds: projections.stage2.eliminated.map((team) => team.teamId).sort(compareTeams),
      playoffPlacement: null,
      eliminationStage: "stage2",
    },
    {
      teamIds: projections.stage1.eliminated.map((team) => team.teamId).sort(compareTeams),
      playoffPlacement: null,
      eliminationStage: "stage1",
    },
  ];

  const ordered = groups.flatMap((group) =>
    group.teamIds.map((teamId) => ({
      teamId,
      playoffPlacement: group.playoffPlacement,
      eliminationStage: group.eliminationStage,
    })),
  );
  if (ordered.length !== 32 || new Set(ordered.map((row) => row.teamId)).size !== 32) {
    throw new Error("final ranking must contain each of the 32 tournament teams exactly once");
  }

  return ordered.map((row, index) => ({
    rank: index + 1,
    ...row,
    tournamentSeed: teamsById.get(row.teamId)!.tournamentSeed,
  }));
}
