import { describe, expect, it } from "vitest";
import { parseMajorRunSnapshot } from "@/lib/major/run-snapshot";

const v4 = {
  version: 4,
  stagePlan: [{ key: "stage-1", name: "Stage 1", type: "swiss", teamCount: 16, matchFormat: "bo1", finalFormat: null, advanceTiers: [] }],
  rosterRules: { minTeamSize: 5, maxTeamSize: 9, starterCount: 5 },
  affiliationRules: [],
  competitiveProfile: null,
  frozenCompetitiveFacts: [],
  runOptions: {},
};

describe("parseMajorRunSnapshot", () => {
  it("normalizes v4 stage lookup without persisted entrant outputs", () => {
    const parsed = parseMajorRunSnapshot(v4, "stage-1");
    expect(parsed.version).toBe(4);
    expect(parsed.stage.key).toBe("stage-1");
    expect(parsed.tournamentEntrants).toBeUndefined();
  });

  it("rejects malformed frozen roster rules", () => {
    expect(() => parseMajorRunSnapshot({
      ...v4,
      rosterRules: { minTeamSize: 6, maxTeamSize: 5, starterCount: 5 },
    }, "stage-1")).toThrow("StageRun snapshot 无效");
  });

  it("keeps v3 snapshots readable while v4 stops writing runtime outputs", () => {
    const tournamentEntrants = Array.from({ length: 32 }, (_, index) => ({
      entrantId: randomUUID(),
      competitionEntryId: randomUUID(),
      tournamentSeed: index + 1,
    }));
    const parsed = parseMajorRunSnapshot({
      ...v4,
      version: 3,
      stage: v4.stagePlan[0],
      tournamentEntrants,
    }, "stage-1");
    expect(parsed.version).toBe(3);
    expect(parsed.tournamentEntrants).toHaveLength(32);
  });
});
import { randomUUID } from "node:crypto";
