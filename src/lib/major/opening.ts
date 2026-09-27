// Managed Major opening plan preview. It reads the frozen-capable stage plan,
// validates the supported profile and does not create matches or mutate state.

import { resolveManagedMajorProfile, type ManagedMajorProfile } from "@/lib/competition/definition";
import type { StageConfig } from "@/types/season";
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

export interface MajorOpeningSwissEntrant extends MajorTournamentSeededTeam {
  /** Stage-local seed; tournamentSeed remains the event-level seed. */
  initialStageSeed: number;
}

export interface MajorOpeningFirstRoundTeam {
  teamId: string;
  tournamentSeed: number;
  stageSeed: number;
}

export interface MajorOpeningFirstRoundPairing {
  round: 1;
  higherSeed: MajorOpeningFirstRoundTeam;
  lowerSeed: MajorOpeningFirstRoundTeam;
  format: MajorSwissMatchFormat;
  pairingRule: MajorSwissPairingRule;
}

export interface MajorOpeningEntryCohort {
  stageKey: string;
  stageName: string;
  fromSeed: number;
  toSeed: number;
  entrants: readonly MajorTournamentSeededTeam[];
}

export interface MajorOpeningPlan {
  profile: Pick<ManagedMajorProfile, "id" | "entrantCapacity">;
  /** Sorted by event seed, exactly 1..profile.entrantCapacity. */
  tournamentTeams: readonly MajorTournamentSeededTeam[];
  entryCohorts: readonly MajorOpeningEntryCohort[];
  stage1: {
    key: string;
    name: string;
    entrants: readonly MajorOpeningSwissEntrant[];
  };
  firstRound: {
    pairings: readonly MajorOpeningFirstRoundPairing[];
  };
}

function normalizeTournamentTeams(
  teams: readonly MajorTournamentSeededTeam[],
  capacity: number,
): readonly MajorTournamentSeededTeam[] {
  if (teams.length !== capacity) {
    throw new Error(`Major opening requires exactly ${capacity} teams (got ${teams.length})`);
  }

  const teamIds = new Set<string>();
  const tournamentSeeds = new Set<number>();
  for (const team of teams) {
    if (typeof team.teamId !== "string" || team.teamId.length === 0) {
      throw new Error("tournament teamId must be a non-empty string");
    }
    if (teamIds.has(team.teamId)) throw new Error(`duplicate tournament teamId: ${team.teamId}`);
    teamIds.add(team.teamId);
    if (!Number.isInteger(team.tournamentSeed) || team.tournamentSeed < 1 || team.tournamentSeed > capacity) {
      throw new Error(`invalid tournamentSeed ${team.tournamentSeed}: must be an integer in 1..${capacity}`);
    }
    if (tournamentSeeds.has(team.tournamentSeed)) throw new Error(`duplicate tournamentSeed: ${team.tournamentSeed}`);
    tournamentSeeds.add(team.tournamentSeed);
  }
  for (let seed = 1; seed <= capacity; seed += 1) {
    if (!tournamentSeeds.has(seed)) throw new Error(`tournamentSeed set must be exactly 1..${capacity}; missing ${seed}`);
  }
  return [...teams].map((team) => ({ ...team })).sort((a, b) => a.tournamentSeed - b.tournamentSeed);
}

function buildFirstRoundPreview(
  entrants: readonly MajorOpeningSwissEntrant[],
  matchFormat: MajorSwissStageMatchFormat,
): readonly MajorOpeningFirstRoundPairing[] {
  const swissEntrants: readonly MajorSwissEntrant[] = entrants.map((entrant) => ({
    teamId: entrant.teamId,
    initialStageSeed: entrant.initialStageSeed,
  }));
  const entrantById = new Map(entrants.map((entrant) => [entrant.teamId, entrant]));
  return generateNextMajorSwissRound({
    entrants: swissEntrants,
    matches: [],
    finalizedRound: 0,
    stageMatchFormat: matchFormat,
  }).map((pairing) => {
    const higher = entrantById.get(pairing.higherSeedTeamId)!;
    const lower = entrantById.get(pairing.lowerSeedTeamId)!;
    return {
      round: 1,
      higherSeed: { teamId: higher.teamId, tournamentSeed: higher.tournamentSeed, stageSeed: higher.initialStageSeed },
      lowerSeed: { teamId: lower.teamId, tournamentSeed: lower.tournamentSeed, stageSeed: lower.initialStageSeed },
      format: pairing.format,
      pairingRule: pairing.pairingRule,
    };
  });
}

/** Construct the opening preview for one of the two supported managed Major profiles. */
export function buildMajorOpeningPlan(input: {
  teams: readonly MajorTournamentSeededTeam[];
  stagePlan: readonly StageConfig[];
}): MajorOpeningPlan {
  const profile = resolveManagedMajorProfile({ stagePlan: input.stagePlan });
  if (!profile) throw new Error("Major opening requires a supported managed Major stage plan");
  const tournamentTeams = normalizeTournamentTeams(input.teams, profile.entrantCapacity);
  const entryCohorts = profile.directEntryCohorts.map((cohort) => ({
    ...cohort,
    entrants: tournamentTeams.filter((team) => team.tournamentSeed >= cohort.fromSeed && team.tournamentSeed <= cohort.toSeed),
  }));
  const firstSwiss = profile.swissStages[0]!;
  const firstCohort = entryCohorts.find((cohort) => cohort.stageKey === firstSwiss.key)!;
  const entrantById = new Map(tournamentTeams.map((team) => [team.teamId, team]));
  const stageOneEntrants = seedMajorStageOneEntrants(firstCohort.entrants).map((entrant) => ({
    ...entrantById.get(entrant.teamId)!,
    initialStageSeed: entrant.initialStageSeed,
  }));

  return {
    profile: { id: profile.id, entrantCapacity: profile.entrantCapacity },
    tournamentTeams,
    entryCohorts,
    stage1: { key: firstSwiss.key, name: firstSwiss.name, entrants: stageOneEntrants },
    firstRound: { pairings: buildFirstRoundPreview(stageOneEntrants, firstSwiss.matchFormat as MajorSwissStageMatchFormat) },
  };
}
