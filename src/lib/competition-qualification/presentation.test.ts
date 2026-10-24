import { expect, it } from "vitest";
import { buildQualificationSwissMatchRecord, buildQualificationSwissReadModel, type QualificationSwissMatch } from "./presentation";
import { generateShortSwissRoundPairings } from "./swiss";
import type { SwissCompletedMatch } from "@/lib/swiss/types";

function fixture(completedRounds: number) {
  const entrants = Array.from({ length: 6 }, (_, i) => ({ entryId: `entry-${i + 1}`, preliminarySeed: i + 1, teamName: `Team ${i + 1}` }));
  const players = entrants.slice(2).map(e => ({ teamId: e.entryId, initialSeed: e.preliminarySeed - 2 }));
  const completed: SwissCompletedMatch[] = [];
  const matches: QualificationSwissMatch[] = [];
  for (let round = 1; round <= Math.min(completedRounds + 1, 3); round++) {
    const pairs = generateShortSwissRoundPairings({ entrants: players, matches: completed, completedRound: round - 1 });
    for (const [index, pair] of pairs.entries()) {
      const id = `${round}-${index}`;
      const finished = round <= completedRounds;
      matches.push({ id, entryAId: pair.higherSeedTeamId, entryBId: pair.lowerSeedTeamId, round,
        scoreA: finished ? 1 : null, scoreB: finished ? 0 : null, status: finished ? "finished" : "scheduled",
        format: "bo1", stage: "play-in", ownership: "manual", majorStageRunId: null, managedKey: null, bracketNodeId: null });
      if (finished) completed.push({ matchId: id, round, entryAId: pair.higherSeedTeamId, entryBId: pair.lowerSeedTeamId, winnerId: pair.higherSeedTeamId });
    }
  }
  return { directEntryCount: 2, entrants, matches };
}

it.each([0, 1, 2, 3])("keeps every pre-round record equivalent to the full canonical view after %i rounds", completed => {
  const input = fixture(completed);
  const full = buildQualificationSwissReadModel(input)!;
  expect(full).not.toBeNull();
  for (const round of full.rounds) for (const group of round.groups) for (const match of group.matchups) {
    expect(buildQualificationSwissMatchRecord(input, match.matchId)).toEqual({ stageName: full.stageName, record: group.record });
  }
  if (completed >= 1) expect(buildQualificationSwissMatchRecord(input, "2-0")?.record).not.toBe("0:0");
  expect(buildQualificationSwissMatchRecord(input, "absent")).toBeNull();
});

it.each([
  ["frozen seed gap", (i: ReturnType<typeof fixture>) => { i.entrants[0]!.preliminarySeed = 9; }],
  ["foreign membership", (i: ReturnType<typeof fixture>) => { i.matches[1]!.entryBId = "foreign"; }],
  ["direct entrant in Play-in", (i: ReturnType<typeof fixture>) => { i.matches[1]!.entryBId = i.entrants[0]!.entryId; }],
  ["noncanonical pairing", (i: ReturnType<typeof fixture>) => { i.matches[1]!.entryBId = i.matches[0]!.entryBId; }],
  ["missing peer pairing", (i: ReturnType<typeof fixture>) => { i.matches.splice(1, 1); }],
  ["future round gap", (i: ReturnType<typeof fixture>) => { i.matches.push({ ...i.matches[0]!, id: "future", round: 3 }); }],
  ["wrong format", (i: ReturnType<typeof fixture>) => { i.matches[1]!.format = "bo3"; }],
  ["wrong stage", (i: ReturnType<typeof fixture>) => { i.matches[1]!.stage = "stage1"; }],
  ["managed ownership", (i: ReturnType<typeof fixture>) => { i.matches[1]!.ownership = "major_stage"; }],
  ["bracket linkage", (i: ReturnType<typeof fixture>) => { i.matches[1]!.bracketNodeId = "node"; }],
  ["managed key", (i: ReturnType<typeof fixture>) => { i.matches[1]!.managedKey = "managed"; }],
  ["Major run linkage", (i: ReturnType<typeof fixture>) => { i.matches[1]!.majorStageRunId = "run"; }],
  ["noncanonical finished scores", (i: ReturnType<typeof fixture>) => { Object.assign(i.matches[1]!, { status: "finished", scoreA: 13, scoreB: 7 }); }],
] as const)("rejects the whole run on %s even when the requested match itself is unchanged", (_, corrupt) => {
  const input = fixture(0);
  corrupt(input);
  expect(buildQualificationSwissReadModel(input)).toBeNull();
  expect(buildQualificationSwissMatchRecord(input, input.matches[0]!.id)).toBeNull();
});
