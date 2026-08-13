import type { MajorTournamentSeededTeam } from "./seeding";
import {
  getMajorSwissQualifiers,
  projectMajorSwissStage,
  type MajorSwissEntrant,
  type MajorSwissMatchFact,
  type MajorSwissProjection,
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

/** A canonical final-result group; teams within a group have no relative placement. */
export interface MajorFinalPlacementGroup {
  from: number;
  to: number;
  teamIds: readonly string[];
}

interface StageProjections {
  stage1: MajorSwissProjection;
  stage2: MajorSwissProjection;
  stage3: MajorSwissProjection;
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
    throw new Error(`Major final placements require exactly 32 teams (got ${teams.length})`);
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

function projectCompleteStage(facts: MajorSwissStageFacts, label: string): MajorSwissProjection {
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

function deterministicPresentationOrder(
  teamsById: ReadonlyMap<string, MajorTournamentSeededTeam>,
): (teamAId: string, teamBId: string) => number {
  return (teamAId, teamBId) =>
    teamsById.get(teamAId)!.tournamentSeed - teamsById.get(teamBId)!.tournamentSeed ||
    (teamAId < teamBId ? -1 : teamAId > teamBId ? 1 : 0);
}

function eliminatedWithRecord(
  projection: MajorSwissProjection,
  wins: 0 | 1 | 2,
  expectedCount: number,
  label: string,
): readonly string[] {
  const teamIds = projection.eliminated
    .filter((team) => team.wins === wins && team.losses === 3)
    .map((team) => team.teamId);
  if (teamIds.length !== expectedCount) {
    throw new Error(`${label} must contain exactly ${expectedCount} eliminated ${wins}-3 teams`);
  }
  return teamIds;
}

function buildSwissPlacementGroups(
  projection: MajorSwissProjection,
  ranges: readonly [number, number][],
  label: string,
  sortTeamIds: (teamAId: string, teamBId: string) => number,
): readonly MajorFinalPlacementGroup[] {
  const records: readonly (0 | 1 | 2)[] = [2, 1, 0];
  const expectedCounts = [3, 3, 2] as const;
  return records.map((wins, index) => ({
    from: ranges[index][0],
    to: ranges[index][1],
    teamIds: [...eliminatedWithRecord(projection, wins, expectedCounts[index], label)].sort(sortTeamIds),
  }));
}

function assertPlacementGroups(groups: readonly MajorFinalPlacementGroup[]): void {
  let expectedFrom = 1;
  const teamIds = new Set<string>();
  for (const group of groups) {
    if (!Number.isInteger(group.from) || !Number.isInteger(group.to) || group.from !== expectedFrom) {
      throw new Error("final placement groups must have contiguous ranges without gaps or overlap");
    }
    if (group.to < group.from || group.teamIds.length !== group.to - group.from + 1) {
      throw new Error(`placement group ${group.from}-${group.to} has an invalid team count`);
    }
    for (const teamId of group.teamIds) {
      if (teamIds.has(teamId)) {
        throw new Error(`final placements contain duplicate teamId: ${teamId}`);
      }
      teamIds.add(teamId);
    }
    expectedFrom = group.to + 1;
  }
  if (expectedFrom !== 33 || teamIds.size !== 32) {
    throw new Error("final placements must contain each of the 32 tournament teams exactly once");
  }
}

export function buildFinalMajorPlacements(input: {
  tournamentTeams: readonly MajorTournamentSeededTeam[];
  stage1: MajorSwissStageFacts;
  stage2: MajorSwissStageFacts;
  stage3: MajorSwissStageFacts;
  playoffMatches: readonly MajorPlayoffMatchFact[];
  hasThirdPlaceMatch: boolean;
}): readonly MajorFinalPlacementGroup[] {
  const teamsById = indexTournamentTeams(input.tournamentTeams);
  const projections: StageProjections = {
    stage1: projectCompleteStage(input.stage1, "Stage 1"),
    stage2: projectCompleteStage(input.stage2, "Stage 2"),
    stage3: projectCompleteStage(input.stage3, "Stage 3"),
  };
  validateProgression(new Set(teamsById.keys()), projections);

  const playoff = projectMajorPlayoff({
    entrants: seedMajorPlayoffEntrants(getMajorSwissQualifiers(projections.stage3)),
    matches: input.playoffMatches,
    hasThirdPlaceMatch: input.hasThirdPlaceMatch,
  });
  const sortTeamIds = deterministicPresentationOrder(teamsById);
  if (input.hasThirdPlaceMatch && (playoff.thirdPlaceId === null || playoff.fourthPlaceId === null)) {
    throw new Error("third-place playoffs must produce third and fourth placements");
  }
  const playoffGroups: readonly MajorFinalPlacementGroup[] = input.hasThirdPlaceMatch
    ? [
        { from: 1, to: 1, teamIds: [playoff.championId] },
        { from: 2, to: 2, teamIds: [playoff.runnerUpId] },
        { from: 3, to: 3, teamIds: [playoff.thirdPlaceId!] },
        { from: 4, to: 4, teamIds: [playoff.fourthPlaceId!] },
        { from: 5, to: 8, teamIds: [...playoff.quarterfinalLoserIds].sort(sortTeamIds) },
      ]
    : [
        { from: 1, to: 1, teamIds: [playoff.championId] },
        { from: 2, to: 2, teamIds: [playoff.runnerUpId] },
        // Order within a placement group is deterministic presentation only, not relative placement.
        { from: 3, to: 4, teamIds: [...playoff.semifinalLoserIds].sort(sortTeamIds) },
        { from: 5, to: 8, teamIds: [...playoff.quarterfinalLoserIds].sort(sortTeamIds) },
      ];

  const groups = [
    ...playoffGroups,
    ...buildSwissPlacementGroups(projections.stage3, [[9, 11], [12, 14], [15, 16]], "Stage 3", sortTeamIds),
    ...buildSwissPlacementGroups(projections.stage2, [[17, 19], [20, 22], [23, 24]], "Stage 2", sortTeamIds),
    ...buildSwissPlacementGroups(projections.stage1, [[25, 27], [28, 30], [31, 32]], "Stage 1", sortTeamIds),
  ];
  assertPlacementGroups(groups);
  return groups;
}
