import type {
  Choices,
  QualificationShortSwissContext,
  SimMatch,
  SimStage,
} from "@/lib/predictions/types";
import type { SwissCompletedMatch } from "@/lib/swiss/types";
import {
  SHORT_SWISS_MAX_ROUNDS,
  SHORT_SWISS_WIN_THRESHOLD,
  SHORT_SWISS_LOSS_THRESHOLD,
} from "./policy";
import {
  generateShortSwissRoundPairings,
  projectShortSwissStage,
} from "./swiss";

/** Local worldline only. Pairing and ranking remain owned by Short Swiss. */
export function simulateQualification(
  context: QualificationShortSwissContext,
  choices: Choices,
): SimStage[] {
  const facts: SwissCompletedMatch[] = [];
  const rows: SimMatch[] = [];
  let completedRound = 0;
  let officialPath = true;
  for (let round = 1; round <= SHORT_SWISS_MAX_ROUNDS; round++) {
    const pairings = generateShortSwissRoundPairings({
      entrants: context.entrants,
      matches: facts,
      completedRound,
    });
    const roundOfficial = officialPath;
    const roundRows = pairings.map((pair, i): SimMatch => {
      const key = `r${round}-${i + 1}`;
      const a = pair.higherSeedTeamId,
        b = pair.lowerSeedTeamId;
      const choice = choices[`play-in/${key}`];
      const selected =
        choice &&
        [choice.a, choice.b].includes(a) &&
        [choice.a, choice.b].includes(b) &&
        [a, b].includes(choice.winner);
      const official = roundOfficial
        ? context.baseline.matches.find(
            (m) =>
              m.round === round &&
              [m.a, m.b].includes(a) &&
              [m.a, m.b].includes(b),
          )
        : undefined;
      const winner = selected ? choice.winner : (official?.winner ?? a);
      if (winner !== official?.winner) officialPath = false;
      return {
        officialMatchId: official?.id,
        key,
        round,
        a,
        b,
        winner,
        record: pair.record,
        format: "bo1",
        source: selected
          ? "assumption"
          : official?.winner
            ? "official"
            : "preview",
        scoreA:
          !selected && official?.winner
            ? official.a === a
              ? official.scoreA
              : official.scoreB
            : null,
        scoreB:
          !selected && official?.winner
            ? official.a === a
              ? official.scoreB
              : official.scoreA
            : null,
      };
    });
    rows.push(...roundRows);
    facts.push(
      ...roundRows.map((m) => ({
        matchId: m.key,
        round,
        entryAId: m.a,
        entryBId: m.b,
        winnerId: m.winner!,
      })),
    );
    completedRound = round;
    if (
      projectShortSwissStage({
        entrants: context.entrants,
        matches: facts,
        completedRound,
      }).isComplete
    )
      break;
  }
  const projection = projectShortSwissStage({
    entrants: context.entrants,
    matches: facts,
    completedRound,
  });
  return [
    {
      key: "play-in",
      entrants: context.entrants.map((e) => ({
        teamId: e.teamId,
        seed: e.initialSeed,
      })),
      officialEntrants: true,
      matches: rows,
      complete: projection.isComplete,
      pick: null,
      swissPolicy: {
        winThreshold: SHORT_SWISS_WIN_THRESHOLD,
        lossThreshold: SHORT_SWISS_LOSS_THRESHOLD,
      },
      standings: projection.teams.map((t) => ({
        teamId: t.teamId,
        wins: t.wins,
        losses: t.losses,
      })),
    },
  ];
}
