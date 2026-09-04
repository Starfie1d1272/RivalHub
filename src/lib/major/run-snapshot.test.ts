import { describe, expect, it } from "vitest";
import { makeMajorRunSnapshotV4, parseMajorRunSnapshot } from "@/lib/major/run-snapshot";

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

  it("freezes the qualification capability and revision-scoped override facts", () => {
    const snapshot = makeMajorRunSnapshotV4({
      ...v4,
      qualificationPolicy: { externalStrengthGap: { enabled: true, maxGap: 3 } },
      frozenRestrictionOverrides: [{
        entryId: "00000000-0000-0000-0000-000000000001",
        rosterRevisionId: "00000000-0000-0000-0000-000000000002",
        restrictionCode: "external_strength_gap",
        findingSnapshot: {
          code: "external_strength_gap",
          message: "外校选手高于本校基线超过 3 星。",
          waivable: true,
          metadata: { strongestExternalStars: 39, strongestHomeStars: 35, externalStrengthMaxStarGap: 3 },
        },
        reason: "赛委会核验后允许本届报名。",
        grantedBy: "admin-1",
        grantedAt: "2026-09-04T00:00:00.000Z",
      }],
    });
    const parsed = parseMajorRunSnapshot(snapshot, "stage-1");
    expect(parsed.qualificationPolicy).toEqual({ externalStrengthGap: { enabled: true, maxGap: 3 } });
    expect(parsed.frozenRestrictionOverrides).toHaveLength(1);
    expect(parsed.frozenRestrictionOverrides?.[0]).toMatchObject({ restrictionCode: "external_strength_gap", rosterRevisionId: "00000000-0000-0000-0000-000000000002" });
  });
});
import { randomUUID } from "node:crypto";
