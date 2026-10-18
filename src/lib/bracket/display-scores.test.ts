import { expect, it } from "vitest";
import type { BracketData } from "./index";
import { projectBracketDisplayScores } from "./display-scores";

// The viewer may reverse participant slots; round-score rendering must preserve
// the winning side, the immutable bracket input, and unknown score semantics.
it("projects scores in participant order without changing bracket outcome facts", () => {
  const data: BracketData = { stage: [], group: [], round: [], match_game: [],
    participant: [{ id: 1, name: "A", rivalhubEntryId: "a" }, { id: 2, name: "B", rivalhubEntryId: "b" }],
    match: [{ id: 9, stage_id: 0, group_id: 0, round_id: 0, number: 1, status: 4, child_count: 0,
      opponent1: { id: 2, score: 0, result: "loss" }, opponent2: { id: 1, score: 1, result: "win" } }],
  };
  const projected = projectBracketDisplayScores(data, [{ bracketNodeId: "9", entryAId: "a", entryBId: "b", displayScore: { scoreA: 13, scoreB: 6, kind: "rounds" } }]);
  expect(projected.match[0]).toMatchObject({ opponent1: { id: 2, score: 6, result: "loss" }, opponent2: { id: 1, score: 13, result: "win" } });
  expect(data.match[0]).toMatchObject({ opponent1: { score: 0 }, opponent2: { score: 1 } });
  const unknown = projectBracketDisplayScores(data, [{ bracketNodeId: "9", entryAId: "a", entryBId: "b", displayScore: { scoreA: null, scoreB: null, kind: "series" } }]);
  expect(unknown.match[0].opponent1?.score).toBeUndefined();
  expect(projectBracketDisplayScores(data, [{ bracketNodeId: "9", entryAId: "a", entryBId: "c", displayScore: { scoreA: 13, scoreB: 6, kind: "rounds" } }]).match[0]).toEqual(data.match[0]);
});
