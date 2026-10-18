import { describe, expect, it } from "vitest";
import { getSwissResultDisplayEntries } from "./swiss-display-results";
import type { SwissStageReadModel, StageSwissMatchRow } from "./stage-read-model";

function fixture(): SwissStageReadModel {
  return {
    stageName: "Play-in", stageKey: "play-in", finalizedRound: 2, teamCount: 6, advanceCount: 3,
    competitionEntries: Array.from({ length: 6 }, (_, i) => ({ entryId: `${i}`, teamName: `Team ${i}`, seed: i + 1, wins: 1, losses: 1, difficultyScore: 2, status: "active" })),
    rounds: [{ round: 3, status: "active", groups: [{ record: "1:1", matchups: [0, 2, 4].map(i => ({
      matchId: `m${i}`, entryAId: `${i}`, entryBId: `${i + 1}`, teamAName: `Team ${i}`, teamBName: `Team ${i + 1}`,
      round: 3, format: "bo1", status: i === 4 ? "scheduled" : "finished", scoreA: i === 4 ? null : 0, scoreB: i === 4 ? null : 1,
    })) }] }],
  };
}

describe("Swiss result display before round finalization", () => {
  it("shows two settled winners and losers while leaving the unplayed match and canonical snapshot unchanged", () => {
    const data = fixture();
    const original = structuredClone(data);
    const result = getSwissResultDisplayEntries(data);
    expect(result.filter(t => t.wins === 2 && t.losses === 1).map(t => t.entryId)).toEqual(["1", "3"]);
    expect(result.filter(t => t.wins === 1 && t.losses === 2).map(t => t.entryId)).toEqual(["0", "2"]);
    expect(result.filter(t => t.wins === 1 && t.losses === 1).map(t => t.entryId)).toEqual(["4", "5"]);
    expect(data).toEqual(original);
  });

  it.each([
    { status: "in_progress" }, { status: "cancelled" }, { scoreA: null }, { scoreA: 1 }, { scoreA: -1 }, { scoreA: NaN },
  ] satisfies Partial<StageSwissMatchRow>[])("does not infer a result from unsettled or invalid scores: %j", patch => {
    const data = fixture();
    Object.assign(data.rounds[0].groups[0].matchups[0], patch);
    expect(getSwissResultDisplayEntries(data).find(t => t.entryId === "0")).toMatchObject({ wins: 1, losses: 1 });
  });

  it("does not count a finalized round twice", () => {
    const data = fixture();
    data.finalizedRound = 3;
    data.rounds[0].status = "finished";
    data.competitionEntries[0] = { ...data.competitionEntries[0], wins: 1, losses: 2, status: "eliminated" };
    expect(getSwissResultDisplayEntries(data)[0]).toMatchObject({ wins: 1, losses: 2 });
  });

  it("does not count duplicate or conflicting pairings", () => {
    const data = fixture();
    data.rounds[0].groups[0].matchups.push({ ...data.rounds[0].groups[0].matchups[0] });
    expect(getSwissResultDisplayEntries(data)[0]).toMatchObject({ wins: 1, losses: 1 });
  });
});
