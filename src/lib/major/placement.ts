import { z } from "zod";
import { resolveManagedMajorProfile } from "@/lib/competition/definition";
import type { StageConfig } from "@/types/season";
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

export interface MajorSwissStageResult {
  stageKey: string;
  facts: MajorSwissStageFacts;
}

/** A canonical final-result group; teams within a group have no relative placement. */
export interface MajorFinalPlacementGroup {
  from: number;
  to: number;
  entryIds: readonly string[];
}

const finalPlacementGroupSchema = z.object({
  from: z.number().int().positive(),
  to: z.number().int().positive(),
  entryIds: z.array(z.guid()).min(1),
});

/** Parse stored placements against the entrant count from the frozen StageRun profile. */
export function parseMajorFinalPlacementGroups(
  value: unknown,
  championEntryId: string,
  entrantCapacity: 24 | 32,
): MajorFinalPlacementGroup[] {
  const parsed = z.array(finalPlacementGroupSchema).safeParse(value);
  if (!parsed.success) throw new Error("official Major placement groups have an invalid shape");
  let expectedFrom = 1;
  const entryIds = new Set<string>();
  for (const group of parsed.data) {
    if (group.from !== expectedFrom || group.to < group.from || group.entryIds.length !== group.to - group.from + 1) {
      throw new Error("official Major placement groups are not contiguous");
    }
    for (const entryId of group.entryIds) {
      if (entryIds.has(entryId)) throw new Error("official Major placement groups contain duplicate entries");
      entryIds.add(entryId);
    }
    expectedFrom = group.to + 1;
  }
  if (expectedFrom !== entrantCapacity + 1 || entryIds.size !== entrantCapacity) {
    throw new Error(`official Major placement groups must cover ${entrantCapacity} entries exactly once`);
  }
  if (parsed.data[0]?.entryIds[0] !== championEntryId) {
    throw new Error("official Major champion must equal first placement entry");
  }
  return parsed.data;
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
  capacity: number,
): Map<string, MajorTournamentSeededTeam> {
  if (teams.length !== capacity) {
    throw new Error(`Major final placements require exactly ${capacity} teams (got ${teams.length})`);
  }
  const byId = new Map<string, MajorTournamentSeededTeam>();
  const seeds = new Set<number>();
  for (const team of teams) {
    if (typeof team.teamId !== "string" || team.teamId.length === 0) throw new Error("tournament teamId must be a non-empty string");
    if (byId.has(team.teamId)) throw new Error(`duplicate tournament teamId: ${team.teamId}`);
    if (!Number.isInteger(team.tournamentSeed) || team.tournamentSeed < 1 || team.tournamentSeed > capacity) {
      throw new Error(`invalid tournamentSeed ${team.tournamentSeed}: must be in 1..${capacity}`);
    }
    if (seeds.has(team.tournamentSeed)) throw new Error(`duplicate tournamentSeed: ${team.tournamentSeed}`);
    byId.set(team.teamId, team);
    seeds.add(team.tournamentSeed);
  }
  for (let seed = 1; seed <= capacity; seed += 1) {
    if (!seeds.has(seed)) throw new Error(`Major tournament seeds must cover 1..${capacity}; missing ${seed}`);
  }
  return byId;
}

function projectCompleteStage(facts: MajorSwissStageFacts, label: string): MajorSwissProjection {
  const projection = projectMajorSwissStage({ entrants: facts.entrants, matches: facts.matches, finalizedRound: 5 });
  if (!projection.isComplete || projection.advanced.length !== 8 || projection.eliminated.length !== 8) {
    throw new Error(`${label} must be a complete 8-advance / 8-eliminate Swiss stage`);
  }
  return projection;
}

function validateProgression(input: {
  tournamentTeams: ReadonlyMap<string, MajorTournamentSeededTeam>;
  stagePlan: readonly StageConfig[];
  swissStages: readonly MajorSwissStageResult[];
  projections: readonly MajorSwissProjection[];
}): void {
  const profile = resolveManagedMajorProfile({ stagePlan: input.stagePlan });
  if (!profile || input.swissStages.length !== profile.swissStages.length || input.projections.length !== profile.swissStages.length) {
    throw new Error("Major Swiss facts do not match a supported frozen profile");
  }
  for (const [index, stage] of input.swissStages.entries()) {
    const configured = profile.swissStages[index]!;
    if (stage.stageKey !== configured.key) throw new Error("Major Swiss facts are not in frozen stage order");
    const actual = setOf(input.projections[index]!.teams);
    const cohort = profile.directEntryCohorts.find((candidate) => candidate.stageKey === configured.key)!;
    const directIds = new Set([...input.tournamentTeams.values()]
      .filter((team) => team.tournamentSeed >= cohort.fromSeed && team.tournamentSeed <= cohort.toSeed)
      .map((team) => team.teamId));
    const expected = new Set(directIds);
    if (index > 0) {
      for (const teamId of input.projections[index - 1]!.advanced.map((team) => team.teamId)) expected.add(teamId);
    }
    assertSameSet(actual, expected, `${configured.name} entrants`);
    for (const teamId of actual) {
      if (!input.tournamentTeams.has(teamId)) throw new Error(`${configured.name} contains a team outside the frozen tournament entrants: ${teamId}`);
    }
    if (index > 0) {
      assertSameSet(
        new Set([...actual].filter((teamId) => setOf(input.projections[index - 1]!.teams).has(teamId))),
        setOf(input.projections[index - 1]!.advanced),
        `${configured.name} advancing entrants`,
      );
    }
  }
}

function deterministicPresentationOrder(
  teamsById: ReadonlyMap<string, MajorTournamentSeededTeam>,
): (entryAId: string, entryBId: string) => number {
  return (entryAId, entryBId) => teamsById.get(entryAId)!.tournamentSeed - teamsById.get(entryBId)!.tournamentSeed ||
    (entryAId < entryBId ? -1 : entryAId > entryBId ? 1 : 0);
}

function eliminatedWithRecord(
  projection: MajorSwissProjection,
  wins: 0 | 1 | 2,
  expectedCount: number,
  label: string,
): readonly string[] {
  const entryIds = projection.eliminated.filter((team) => team.wins === wins && team.losses === 3).map((team) => team.teamId);
  if (entryIds.length !== expectedCount) throw new Error(`${label} must contain exactly ${expectedCount} eliminated ${wins}-3 teams`);
  return entryIds;
}

function buildSwissPlacementGroups(
  projection: MajorSwissProjection,
  firstPlace: number,
  label: string,
  sortTeamIds: (entryAId: string, entryBId: string) => number,
): readonly MajorFinalPlacementGroup[] {
  const records: readonly (0 | 1 | 2)[] = [2, 1, 0];
  const expectedCounts = [3, 3, 2] as const;
  return records.map((wins, index) => ({
    from: firstPlace + index * 3,
    to: firstPlace + index * 3 + expectedCounts[index] - 1,
    entryIds: [...eliminatedWithRecord(projection, wins, expectedCounts[index], label)].sort(sortTeamIds),
  }));
}

function assertPlacementGroups(groups: readonly MajorFinalPlacementGroup[], capacity: number): void {
  let expectedFrom = 1;
  const entryIds = new Set<string>();
  for (const group of groups) {
    if (!Number.isInteger(group.from) || !Number.isInteger(group.to) || group.from !== expectedFrom) {
      throw new Error("final placement groups must have contiguous ranges without gaps or overlap");
    }
    if (group.to < group.from || group.entryIds.length !== group.to - group.from + 1) {
      throw new Error(`placement group ${group.from}-${group.to} has an invalid team count`);
    }
    for (const teamId of group.entryIds) {
      if (entryIds.has(teamId)) throw new Error(`final placements contain duplicate teamId: ${teamId}`);
      entryIds.add(teamId);
    }
    expectedFrom = group.to + 1;
  }
  if (expectedFrom !== capacity + 1 || entryIds.size !== capacity) {
    throw new Error(`final placements must contain each of the ${capacity} tournament teams exactly once`);
  }
}

export function buildFinalMajorPlacements(input: {
  tournamentTeams: readonly MajorTournamentSeededTeam[];
  stagePlan: readonly StageConfig[];
  swissStages: readonly MajorSwissStageResult[];
  playoffMatches: readonly MajorPlayoffMatchFact[];
  hasThirdPlaceMatch: boolean;
}): readonly MajorFinalPlacementGroup[] {
  const profile = resolveManagedMajorProfile({ stagePlan: input.stagePlan });
  if (!profile || input.swissStages.length !== profile.swissStages.length) {
    throw new Error("Major final placements require a supported frozen stage plan and matching Swiss facts");
  }
  const teamsById = indexTournamentTeams(input.tournamentTeams, profile.entrantCapacity);
  const projections = input.swissStages.map((stage, index) => projectCompleteStage(stage.facts, profile.swissStages[index]!.name));
  validateProgression({ tournamentTeams: teamsById, stagePlan: input.stagePlan, swissStages: input.swissStages, projections });
  const finalSwissProjection = projections.at(-1)!;
  const playoff = projectMajorPlayoff({
    entrants: seedMajorPlayoffEntrants(getMajorSwissQualifiers(finalSwissProjection)),
    matches: input.playoffMatches,
    hasThirdPlaceMatch: input.hasThirdPlaceMatch,
  });
  const sortTeamIds = deterministicPresentationOrder(teamsById);
  if (input.hasThirdPlaceMatch && (playoff.thirdPlaceId === null || playoff.fourthPlaceId === null)) {
    throw new Error("third-place playoffs must produce third and fourth placements");
  }
  const playoffGroups: readonly MajorFinalPlacementGroup[] = input.hasThirdPlaceMatch
    ? [
        { from: 1, to: 1, entryIds: [playoff.championId] },
        { from: 2, to: 2, entryIds: [playoff.runnerUpId] },
        { from: 3, to: 3, entryIds: [playoff.thirdPlaceId!] },
        { from: 4, to: 4, entryIds: [playoff.fourthPlaceId!] },
        { from: 5, to: 8, entryIds: [...playoff.quarterfinalLoserIds].sort(sortTeamIds) },
      ]
    : [
        { from: 1, to: 1, entryIds: [playoff.championId] },
        { from: 2, to: 2, entryIds: [playoff.runnerUpId] },
        { from: 3, to: 4, entryIds: [...playoff.semifinalLoserIds].sort(sortTeamIds) },
        { from: 5, to: 8, entryIds: [...playoff.quarterfinalLoserIds].sort(sortTeamIds) },
      ];

  const swissPlacementGroups = [...projections].reverse().flatMap((projection, reverseIndex) => {
    const stageIndex = projections.length - reverseIndex - 1;
    return buildSwissPlacementGroups(projection, 9 + reverseIndex * 8, profile.swissStages[stageIndex]!.name, sortTeamIds);
  });
  const groups = [...playoffGroups, ...swissPlacementGroups];
  assertPlacementGroups(groups, profile.entrantCapacity);
  return groups;
}
