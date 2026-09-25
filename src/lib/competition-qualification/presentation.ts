import type { SwissStageReadModel, StageSwissMatchRow, StageSwissRoundColumn } from "@/lib/matches/stage-read-model";
import { projectSwissStage } from "@/lib/swiss/core";
import type { SwissCompletedMatch, SwissEntrant, SwissProjection } from "@/lib/swiss/types";
import { generateShortSwissRoundPairings } from "./swiss";

export interface QualificationSwissEntrant {
  entryId: string;
  teamName: string;
  preliminarySeed: number;
}

export interface QualificationSwissMatch {
  id: string;
  entryAId: string;
  entryBId: string;
  round: number | null;
  scoreA: number | null;
  scoreB: number | null;
  status: string;
  format: string;
  stage: string;
  ownership: string;
  majorStageRunId: string | null;
  managedKey: string | null;
  bracketNodeId: string | null;
}

function pairKey(entryAId: string, entryBId: string): string {
  return [entryAId, entryBId].sort().join(":");
}

/** Build a public Swiss read model only when persisted Play-in facts match the canonical round rules. */
export function buildQualificationSwissReadModel(input: {
  directEntryCount: number;
  entrants: readonly QualificationSwissEntrant[];
  matches: readonly QualificationSwissMatch[];
}): SwissStageReadModel | null {
  const ordered = [...input.entrants].sort((a, b) => a.preliminarySeed - b.preliminarySeed);
  if (ordered.some((entrant, index) => entrant.preliminarySeed !== index + 1)) return null;
  const entrants: SwissEntrant[] = ordered
    .filter((entrant) => entrant.preliminarySeed > input.directEntryCount)
    .map((entrant) => ({ teamId: entrant.entryId, initialSeed: entrant.preliminarySeed - input.directEntryCount }));
  if (entrants.length < 2 || entrants.some((entrant, index) => entrant.initialSeed !== index + 1)) return null;

  const matchRows = [...input.matches].sort((a, b) => (a.round ?? Infinity) - (b.round ?? Infinity) || a.id.localeCompare(b.id));
  if (matchRows.some((match) => !Number.isInteger(match.round) || match.round! < 1 || match.round! > 5 ||
    match.format !== "bo1" || match.stage !== "play-in" || match.ownership !== "manual" ||
    match.majorStageRunId !== null || match.managedKey !== null || match.bracketNodeId !== null ||
    match.entryAId === match.entryBId || !entrants.some((entrant) => entrant.teamId === match.entryAId) ||
    !entrants.some((entrant) => entrant.teamId === match.entryBId) ||
    (match.status === "finished" && (match.scoreA === null || match.scoreB === null ||
      Math.max(match.scoreA, match.scoreB) !== 1 || Math.min(match.scoreA, match.scoreB) !== 0)))) return null;

  const facts: SwissCompletedMatch[] = [];
  const projections: SwissProjection[] = [];
  let projection: SwissProjection;
  try {
    projection = projectSwissStage({ entrants, matches: facts, completedRound: 0, config: { winThreshold: 2, lossThreshold: 2 } });
    for (let round = 1; round <= 5; round += 1) {
      const rows = matchRows.filter((match) => match.round === round);
      if (rows.length === 0) break;
      const expected = generateShortSwissRoundPairings({ entrants, matches: facts, completedRound: round - 1 });
      const expectedPairs = new Set(expected.map((pair) => pairKey(pair.higherSeedTeamId, pair.lowerSeedTeamId)));
      const actualPairs = rows.map((match) => pairKey(match.entryAId, match.entryBId));
      if (actualPairs.length !== expectedPairs.size || new Set(actualPairs).size !== actualPairs.length ||
        actualPairs.some((key) => !expectedPairs.has(key))) return null;
      if (rows.some((match) => match.status !== "finished")) break;
      for (const match of rows) {
        if (match.scoreA === null || match.scoreB === null || match.scoreA === match.scoreB) return null;
        facts.push({
          matchId: match.id,
          round,
          entryAId: match.entryAId,
          entryBId: match.entryBId,
          winnerId: match.scoreA > match.scoreB ? match.entryAId : match.entryBId,
        });
      }
      projection = projectSwissStage({ entrants, matches: facts, completedRound: round, config: { winThreshold: 2, lossThreshold: 2 } });
      projections[round] = projection;
    }
    if (matchRows.some((match) => match.round! > projection.completedRound + 1)) return null;
  } catch {
    return null;
  }

  const nameByEntryId = new Map(ordered.map((entrant) => [entrant.entryId, entrant.teamName]));
  const rows: StageSwissMatchRow[] = matchRows.map((match) => ({
    matchId: match.id,
    entryAId: match.entryAId,
    entryBId: match.entryBId,
    teamAName: nameByEntryId.get(match.entryAId) ?? "未知队伍",
    teamBName: nameByEntryId.get(match.entryBId) ?? "未知队伍",
    scoreA: match.scoreA,
    scoreB: match.scoreB,
    status: match.status,
    format: match.format,
    round: match.round!,
  }));
  const rounds: StageSwissRoundColumn[] = [];
  for (let round = 1; round <= 5; round += 1) {
    const roundRows = rows.filter((match) => match.round === round);
    const beforeRound = round <= projection.completedRound ? projections[round - 1] : projection;
    const stateByEntryId = new Map(beforeRound?.teams.map((team) => [team.teamId, team]) ?? []);
    const groups = new Map<string, StageSwissMatchRow[]>();
    for (const row of roundRows) {
      const teamA = stateByEntryId.get(row.entryAId);
      const teamB = stateByEntryId.get(row.entryBId);
      const recordA = teamA ? `${teamA.wins}:${teamA.losses}` : "待定";
      const recordB = teamB ? `${teamB.wins}:${teamB.losses}` : "待定";
      const key = recordA === recordB ? recordA : `${recordA} | ${recordB}`;
      const group = groups.get(key) ?? [];
      group.push(row);
      groups.set(key, group);
    }
    rounds.push({
      round,
      status: round <= projection.completedRound ? "finished" : round === projection.completedRound + 1 && roundRows.length > 0 ? "active" : "upcoming",
      groups: [...groups.entries()].map(([record, matchups]) => ({ record, matchups })),
    });
  }

  return {
    stageName: "Play-in · Short Swiss",
    stageKey: "play-in",
    finalizedRound: projection.completedRound,
    teamCount: projection.teams.length,
    advanceCount: projection.advanced.length,
    rounds,
    competitionEntries: projection.teams.map((team) => ({
      entryId: team.teamId,
      teamName: nameByEntryId.get(team.teamId) ?? "未知队伍",
      seed: team.currentSeed,
      wins: team.wins,
      losses: team.losses,
      difficultyScore: team.buchholz,
      status: team.status,
    })),
  };
}
