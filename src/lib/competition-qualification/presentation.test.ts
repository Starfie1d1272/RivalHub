import { describe, expect, it } from "vitest";
import { buildQualificationSwissReadModel } from "./presentation";

const entrants = Array.from({ length: 8 }, (_, index) => ({
  entryId: `entry-${index + 1}`,
  teamName: `Team ${index + 1}`,
  preliminarySeed: index + 1,
}));

describe("Qualification Swiss public read model", () => {
  it("uses only the Play-in cut and projects canonical Swiss round facts", () => {
    const data = buildQualificationSwissReadModel({
      directEntryCount: 4,
      entrants,
      matches: [
        { id: "r1-a", entryAId: "entry-5", entryBId: "entry-7", round: 1, scoreA: 1, scoreB: 0, status: "finished", format: "bo1", stage: "play-in", ownership: "manual", majorStageRunId: null, managedKey: null, bracketNodeId: null },
        { id: "r1-b", entryAId: "entry-6", entryBId: "entry-8", round: 1, scoreA: 0, scoreB: 1, status: "finished", format: "bo1", stage: "play-in", ownership: "manual", majorStageRunId: null, managedKey: null, bracketNodeId: null },
      ],
    });

    expect(data?.stageKey).toBe("play-in");
    expect(data?.teamCount).toBe(4);
    expect(data?.finalizedRound).toBe(1);
    expect(data?.competitionEntries.map((entry) => entry.entryId)).toEqual(["entry-5", "entry-8", "entry-6", "entry-7"]);
    expect(data?.rounds[0]?.groups[0]?.matchups.map((match) => match.matchId)).toEqual(["r1-a", "r1-b"]);
  });

  it("fails closed when persisted round pairings cross the canonical seed pairing", () => {
    const data = buildQualificationSwissReadModel({
      directEntryCount: 4,
      entrants,
      matches: [
        { id: "r1-a", entryAId: "entry-5", entryBId: "entry-8", round: 1, scoreA: null, scoreB: null, status: "scheduled", format: "bo1", stage: "play-in", ownership: "manual", majorStageRunId: null, managedKey: null, bracketNodeId: null },
        { id: "r1-b", entryAId: "entry-6", entryBId: "entry-7", round: 1, scoreA: null, scoreB: null, status: "scheduled", format: "bo1", stage: "play-in", ownership: "manual", majorStageRunId: null, managedKey: null, bracketNodeId: null },
      ],
    });

    expect(data).toBeNull();
  });
});
