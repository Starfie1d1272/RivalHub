import type { MajorSwissQualifier } from "./swiss";

export type MajorPlayoffRound = "quarterfinal" | "semifinal" | "third_place" | "final";

export interface MajorPlayoffEntrant {
  teamId: string;

  /** Final Stage 3 seed, exactly 1..8. */
  playoffSeed: number;
}

export interface MajorPlayoffPairing {
  round: MajorPlayoffRound;
  slot: number;
  higherSeedTeamId: string;
  lowerSeedTeamId: string;
  higherSeed: number;
  lowerSeed: number;
}

export interface MajorPlayoffMatchFact {
  matchId: string;
  round: MajorPlayoffRound;

  /** Stable position inside the round: QF 1..4, SF 1..2, Final 1. */
  slot: number;

  teamAId: string;
  teamBId: string;
  winnerId: string;
}

export interface MajorPlayoffProjection {
  championId: string;
  runnerUpId: string;
  thirdPlaceId: string | null;
  fourthPlaceId: string | null;
  semifinalLoserIds: readonly string[];
  quarterfinalLoserIds: readonly string[];
}

const PLAYOFF_TEAM_COUNT = 8;

const QUARTERFINAL_SEED_PAIRS = [
  [1, 8],
  [4, 5],
  [2, 7],
  [3, 6],
] as const;

function assertNonEmptyId(value: string, label: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function pairKey(teamAId: string, teamBId: string): string {
  return teamAId < teamBId
    ? `${teamAId}\u0000${teamBId}`
    : `${teamBId}\u0000${teamAId}`;
}

function loserOf(match: MajorPlayoffMatchFact): string {
  return match.winnerId === match.teamAId ? match.teamBId : match.teamAId;
}

export function seedMajorPlayoffEntrants(
  qualifiers: readonly MajorSwissQualifier[],
): readonly MajorPlayoffEntrant[] {
  if (qualifiers.length !== PLAYOFF_TEAM_COUNT) {
    throw new Error(
      `playoffs require exactly ${PLAYOFF_TEAM_COUNT} Stage 3 qualifiers ` +
        `(got ${qualifiers.length})`,
    );
  }

  const teamIds = new Set<string>();
  const seeds = new Set<number>();
  for (const qualifier of qualifiers) {
    assertNonEmptyId(qualifier.teamId, "qualifier teamId");
    if (teamIds.has(qualifier.teamId)) {
      throw new Error(`duplicate playoff teamId: ${qualifier.teamId}`);
    }
    teamIds.add(qualifier.teamId);

    const seed = qualifier.finalStageSeed;
    if (!Number.isInteger(seed) || seed < 1 || seed > PLAYOFF_TEAM_COUNT) {
      throw new Error(`invalid finalStageSeed ${seed}: must be an integer in 1..8`);
    }
    if (seeds.has(seed)) {
      throw new Error(`duplicate finalStageSeed: ${seed}`);
    }
    seeds.add(seed);
  }

  for (let seed = 1; seed <= PLAYOFF_TEAM_COUNT; seed += 1) {
    if (!seeds.has(seed)) {
      throw new Error(`playoff seed set must be exactly 1..8; missing ${seed}`);
    }
  }

  return [...qualifiers]
    .sort((a, b) => a.finalStageSeed - b.finalStageSeed)
    .map((qualifier) => ({
      teamId: qualifier.teamId,
      playoffSeed: qualifier.finalStageSeed,
    }));
}

/**
 * Valve Major bracket order:
 * Bracket A = 1v8, 4v5; Bracket B = 2v7, 3v6.
 */
export function generateMajorPlayoffQuarterfinals(
  entrants: readonly MajorPlayoffEntrant[],
): readonly MajorPlayoffPairing[] {
  const normalized = seedMajorPlayoffEntrants(
    entrants.map((entrant) => ({
      teamId: entrant.teamId,
      finalStageSeed: entrant.playoffSeed,
    })),
  );
  const bySeed = new Map(normalized.map((entrant) => [entrant.playoffSeed, entrant]));

  return QUARTERFINAL_SEED_PAIRS.map(([higherSeed, lowerSeed], index) => ({
    round: "quarterfinal" as const,
    slot: index + 1,
    higherSeedTeamId: bySeed.get(higherSeed)!.teamId,
    lowerSeedTeamId: bySeed.get(lowerSeed)!.teamId,
    higherSeed,
    lowerSeed,
  }));
}

function indexRound(
  matches: readonly MajorPlayoffMatchFact[],
  round: MajorPlayoffRound,
  expectedCount: number,
): Map<number, MajorPlayoffMatchFact> {
  const roundMatches = matches.filter((match) => match.round === round);
  if (roundMatches.length !== expectedCount) {
    throw new Error(
      `${round} is incomplete: expected ${expectedCount} matches, got ${roundMatches.length}`,
    );
  }

  const bySlot = new Map<number, MajorPlayoffMatchFact>();
  for (const match of roundMatches) {
    if (!Number.isInteger(match.slot) || match.slot < 1 || match.slot > expectedCount) {
      throw new Error(`${round} match ${match.matchId} has invalid slot ${match.slot}`);
    }
    if (bySlot.has(match.slot)) {
      throw new Error(`${round} contains duplicate slot ${match.slot}`);
    }
    bySlot.set(match.slot, match);
  }
  return bySlot;
}

function assertExpectedPair(
  match: MajorPlayoffMatchFact,
  expectedTeamAId: string,
  expectedTeamBId: string,
): void {
  if (
    pairKey(match.teamAId, match.teamBId) !== pairKey(expectedTeamAId, expectedTeamBId)
  ) {
    throw new Error(
      `${match.round} slot ${match.slot} has invalid participants: ` +
        `expected ${expectedTeamAId} vs ${expectedTeamBId}`,
    );
  }
}

export function projectMajorPlayoff(input: {
  entrants: readonly MajorPlayoffEntrant[];
  matches: readonly MajorPlayoffMatchFact[];
  hasThirdPlaceMatch: boolean;
}): MajorPlayoffProjection {
  const entrants = seedMajorPlayoffEntrants(
    input.entrants.map((entrant) => ({
      teamId: entrant.teamId,
      finalStageSeed: entrant.playoffSeed,
    })),
  );
  const entrantIds = new Set(entrants.map((entrant) => entrant.teamId));

  const expectedMatchCount = input.hasThirdPlaceMatch ? 8 : 7;
  if (input.matches.length !== expectedMatchCount) {
    throw new Error(
      `complete playoffs require exactly ${expectedMatchCount} matches (got ${input.matches.length})`,
    );
  }

  const matchIds = new Set<string>();
  for (const match of input.matches) {
    assertNonEmptyId(match.matchId, "playoff matchId");
    if (matchIds.has(match.matchId)) {
      throw new Error(`duplicate playoff matchId: ${match.matchId}`);
    }
    matchIds.add(match.matchId);

    if (!entrantIds.has(match.teamAId) || !entrantIds.has(match.teamBId)) {
      throw new Error(`playoff match ${match.matchId} references a non-entrant team`);
    }
    if (match.teamAId === match.teamBId) {
      throw new Error(`playoff match ${match.matchId} pairs a team with itself`);
    }
    if (match.winnerId !== match.teamAId && match.winnerId !== match.teamBId) {
      throw new Error(`playoff match ${match.matchId} winnerId must be a participant`);
    }
  }

  const quarterfinals = indexRound(input.matches, "quarterfinal", 4);
  const semifinals = indexRound(input.matches, "semifinal", 2);
  const finals = indexRound(input.matches, "final", 1);

  const expectedQuarterfinals = generateMajorPlayoffQuarterfinals(entrants);
  for (const expected of expectedQuarterfinals) {
    assertExpectedPair(
      quarterfinals.get(expected.slot)!,
      expected.higherSeedTeamId,
      expected.lowerSeedTeamId,
    );
  }

  const semifinalOne = semifinals.get(1)!;
  const semifinalTwo = semifinals.get(2)!;
  assertExpectedPair(
    semifinalOne,
    quarterfinals.get(1)!.winnerId,
    quarterfinals.get(2)!.winnerId,
  );
  assertExpectedPair(
    semifinalTwo,
    quarterfinals.get(3)!.winnerId,
    quarterfinals.get(4)!.winnerId,
  );

  const final = finals.get(1)!;
  assertExpectedPair(final, semifinalOne.winnerId, semifinalTwo.winnerId);

  const semifinalLoserIds = [loserOf(semifinalOne), loserOf(semifinalTwo)];
  const thirdPlaceMatch = input.hasThirdPlaceMatch
    ? indexRound(input.matches, "third_place", 1).get(1)!
    : null;
  if (thirdPlaceMatch) {
    assertExpectedPair(thirdPlaceMatch, semifinalLoserIds[0], semifinalLoserIds[1]);
  }

  return {
    championId: final.winnerId,
    runnerUpId: loserOf(final),
    thirdPlaceId: thirdPlaceMatch?.winnerId ?? null,
    fourthPlaceId: thirdPlaceMatch ? loserOf(thirdPlaceMatch) : null,
    semifinalLoserIds,
    quarterfinalLoserIds: [
      loserOf(quarterfinals.get(1)!),
      loserOf(quarterfinals.get(2)!),
      loserOf(quarterfinals.get(3)!),
      loserOf(quarterfinals.get(4)!),
    ],
  };
}
