import { compareSwissRanking, computeValveBuchholzScore } from "./ranking";
import type { SwissCompletedMatch, SwissConfig, SwissEntrant, SwissProjection, SwissRecord, SwissTeamState } from "./types";

function validateConfig(config: SwissConfig): void {
  if (!Number.isInteger(config.winThreshold) || config.winThreshold < 1 ||
      !Number.isInteger(config.lossThreshold) || config.lossThreshold < 1) {
    throw new Error("Swiss win/loss thresholds must be positive integers");
  }
}

function validateEntrants(entrants: readonly SwissEntrant[]): void {
  if (entrants.length < 2) throw new Error("Swiss requires at least two entrants");
  const ids = new Set<string>();
  const seeds = new Set<number>();
  for (const entrant of entrants) {
    if (!entrant.teamId) throw new Error("Swiss entrant teamId must be a non-empty string");
    if (ids.has(entrant.teamId)) throw new Error(`duplicate Swiss entrant teamId: ${entrant.teamId}`);
    ids.add(entrant.teamId);
    if (!Number.isInteger(entrant.initialSeed) || entrant.initialSeed < 1 || entrant.initialSeed > entrants.length) {
      throw new Error(`invalid Swiss initialSeed ${entrant.initialSeed}: must be an integer in 1..${entrants.length}`);
    }
    if (seeds.has(entrant.initialSeed)) throw new Error(`duplicate Swiss initialSeed: ${entrant.initialSeed}`);
    seeds.add(entrant.initialSeed);
  }
  for (let seed = 1; seed <= entrants.length; seed += 1) {
    if (!seeds.has(seed)) throw new Error(`Swiss initialSeed set must be exactly 1..${entrants.length}; missing ${seed}`);
  }
}

function validateCompletedMatches(
  matches: readonly SwissCompletedMatch[],
  entrants: ReadonlySet<string>,
  completedRound: number,
): SwissCompletedMatch[] {
  const official = matches.filter((match) => match.round <= completedRound);
  const ids = new Set<string>();
  for (const match of official) {
    if (!match.matchId) throw new Error("Swiss matchId must be a non-empty string");
    if (ids.has(match.matchId)) throw new Error(`duplicate Swiss matchId: ${match.matchId}`);
    ids.add(match.matchId);
    if (!Number.isInteger(match.round) || match.round < 1 || match.round > completedRound) {
      throw new Error(`invalid Swiss match round: ${match.round}`);
    }
    if (!entrants.has(match.entryAId) || !entrants.has(match.entryBId)) {
      throw new Error(`match ${match.matchId} references a team outside the Swiss entrants`);
    }
    if (match.entryAId === match.entryBId) throw new Error(`match ${match.matchId} pairs a team with itself`);
    if (match.winnerId !== match.entryAId && match.winnerId !== match.entryBId) {
      throw new Error(`match ${match.matchId} winnerId must be one of the participants`);
    }
  }
  return official;
}

function statusFor(record: SwissRecord, config: SwissConfig): SwissTeamState["status"] {
  if (record.wins >= config.winThreshold) return "advanced";
  if (record.losses >= config.lossThreshold) return "eliminated";
  return "active";
}

/** Pure Swiss standings projection from initial seeds and completed canonical matches. */
export function projectSwissStage(input: {
  entrants: readonly SwissEntrant[];
  matches: readonly SwissCompletedMatch[];
  completedRound: number;
  config: SwissConfig;
}): SwissProjection {
  const { entrants, matches, completedRound, config } = input;
  validateConfig(config);
  if (!Number.isInteger(completedRound) || completedRound < 0) throw new Error("Swiss completedRound must be a non-negative integer");
  validateEntrants(entrants);
  const entrantIds = new Set(entrants.map((entrant) => entrant.teamId));
  const official = validateCompletedMatches(matches, entrantIds, completedRound);
  const states = new Map<string, Omit<SwissTeamState, "currentSeed" | "buchholz"> & { opponents: string[] }>();
  for (const entrant of [...entrants].sort((a, b) => a.initialSeed - b.initialSeed)) {
    states.set(entrant.teamId, {
      teamId: entrant.teamId,
      initialSeed: entrant.initialSeed,
      wins: 0,
      losses: 0,
      status: "active",
      opponents: [],
    });
  }

  for (let round = 1; round <= completedRound; round += 1) {
    const roundMatches = official.filter((match) => match.round === round)
      .sort((a, b) => a.matchId.localeCompare(b.matchId));
    const participants = new Set<string>();
    for (const match of roundMatches) {
      const teamA = states.get(match.entryAId)!;
      const teamB = states.get(match.entryBId)!;
      if (teamA.status !== "active" || teamB.status !== "active") {
        throw new Error(`round ${round} match ${match.matchId} includes a non-active team`);
      }
      if (participants.has(teamA.teamId) || participants.has(teamB.teamId)) {
        throw new Error(`round ${round} includes a team more than once`);
      }
      participants.add(teamA.teamId);
      participants.add(teamB.teamId);
    }
    for (const match of roundMatches) {
      const winner = states.get(match.winnerId)!;
      const loserId = match.winnerId === match.entryAId ? match.entryBId : match.entryAId;
      const loser = states.get(loserId)!;
      winner.wins += 1;
      loser.losses += 1;
      winner.opponents.push(loserId);
      loser.opponents.push(winner.teamId);
    }
    for (const team of states.values()) team.status = statusFor(team, config);
  }

  const records = new Map([...states.values()].map((team) => [team.teamId, { wins: team.wins, losses: team.losses }]));
  const ranked = [...states.values()].map((team) => ({
    ...team,
    buchholz: computeValveBuchholzScore(team.opponents, records),
  })).sort(compareSwissRanking);
  const teams: SwissTeamState[] = ranked.map((team, index) => ({
    ...team,
    currentSeed: index + 1,
    opponents: [...team.opponents],
  }));
  const active = teams.filter((team) => team.status === "active");
  return {
    completedRound,
    teams,
    active,
    advanced: teams.filter((team) => team.status === "advanced"),
    eliminated: teams.filter((team) => team.status === "eliminated"),
    isComplete: active.length === 0,
  };
}
