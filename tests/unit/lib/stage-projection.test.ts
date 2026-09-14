import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { MajorSwissStageReadModel } from "@/lib/matches/stage-read-model";
import type { TeamStanding } from "@/lib/standings";
import { projectStage } from "@/lib/demo-integration/stage-projection";
import { rivalHubEventsResponseSchema } from "@/lib/demo-integration/contracts";
import type { StageConfig } from "@/types/season";

const fixture = JSON.parse(
  readFileSync(join(process.cwd(), "tests/fixtures/contracts/rivalhub-dak-events-1-stage-projection.json"), "utf8"),
) as {
  events: Array<{ stages: Array<Record<string, unknown>> }>;
};

describe("DAK stage projection parity", () => {
  it("keeps the golden standings and bracket node shapes accepted by the contract", () => {
    expect(rivalHubEventsResponseSchema.parse(fixture)).toEqual(fixture);
    const [roundRobinFixture, playoffFixture] = fixture.events[0]!.stages;
    const stage = (key: string, type: StageConfig["type"], teamCount: number, advanceCount: number, matchFormat: StageConfig["matchFormat"], finalFormat: StageConfig["finalFormat"]): StageConfig => ({
      key,
      name: key === "group-stage" ? "小组循环赛" : "淘汰赛",
      type,
      teamCount,
      advanceTiers: advanceCount > 0 ? [{ placement: "*", count: advanceCount }] : [],
      matchFormat,
      finalFormat,
    });

    const standings = [
      { teamId: "40000000-0000-4000-8000-000000000011", teamName: "Alpha", seed: 1, wins: 2, losses: 0, totalRoundsWon: 26, netRounds: 8 },
      { teamId: "40000000-0000-4000-8000-000000000012", teamName: "Bravo", seed: 2, wins: 1, losses: 1, totalRoundsWon: 22, netRounds: 0 },
      { teamId: "40000000-0000-4000-8000-000000000013", teamName: "Charlie", seed: 3, wins: 0, losses: 2, totalRoundsWon: 18, netRounds: -8 },
    ] as TeamStanding[];
    const nodes = playoffFixture!.bracketNodes as Array<{
      id: string;
      label: string;
      round: number;
      lane: "single" | "winner" | "loser" | "grand";
      nextWinNodeId: string | null;
      nextLossNodeId: string | null;
    }>;

    expect(projectStage(stage("group-stage", "round_robin", 3, 2, "bo1", undefined), { standings })).toEqual(roundRobinFixture);
    expect(projectStage(stage("playoff", "single_elim", 4, 1, "bo3", "bo5"), {
      bracketNodes: nodes,
    })).toEqual(playoffFixture);
  });

  it("passes through the canonical Swiss tiebreak fact without recomputing it", () => {
    const readModel = {
      competitionEntries: [{
        entryId: "40000000-0000-4000-8000-000000000011",
        teamName: "Alpha",
        seed: 1,
        wins: 3,
        losses: 1,
        difficultyScore: 7,
        status: "advanced",
      }],
    } as MajorSwissStageReadModel;

    expect(projectStage({
      key: "swiss",
      name: "swiss",
      type: "swiss",
      teamCount: 16,
      advanceTiers: [{ placement: "*", count: 8 }],
      matchFormat: "bo1",
    }, { swissReadModel: readModel }).standings).toEqual([
      {
        entryId: "40000000-0000-4000-8000-000000000011",
        teamName: "Alpha",
        rank: 1,
        wins: 3,
        losses: 1,
        tiebreakFacts: { BU: 7 },
        status: "advanced",
      },
    ]);
  });
});
