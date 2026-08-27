import { describe, it, expect } from "vitest";
import {
  classifyDownstreamManagedMatches,
  deriveSwissFinalizedRollback,
  loadFrozenRunFacts,
  resolveWinnerTeamId,
  validateResultCorrectionProposal,
} from "@/lib/match-corrections/service";
import { AppError } from "@/lib/errors";
import type { MajorStageRun } from "@/db/schema";

const TEAM_A = "11111111-1111-1111-1111-111111111111";
const TEAM_B = "22222222-2222-2222-2222-222222222222";

function baseMatch() {
  return { teamAId: TEAM_A, teamBId: TEAM_B, format: "bo1" as const, isForfeit: false };
}

describe("classifyDownstreamManagedMatches", () => {
  const scheduledRound = (round: number, suffix: string): DownstreamCandidate => ({
    id: `m-${suffix}`,
    managedKey: `r${round}-${suffix}`,
    entryRound: null,
    round,
    status: "scheduled",
  });
  type DownstreamCandidate = Parameters<typeof classifyDownstreamManagedMatches>[0][number];
  const started = (row: DownstreamCandidate, status = "in_progress"): DownstreamCandidate => ({
    ...row,
    status,
  });

  it("swiss: classifies every later-round match as invalidatable when unstarted", () => {
    const impacts = classifyDownstreamManagedMatches(
      [scheduledRound(1, "same"), scheduledRound(2, "a"), scheduledRound(3, "b")],
      { id: "m-same", round: 1, entryRound: null },
      "swiss",
    );
    expect(impacts.map((impact) => impact.matchId).sort()).toEqual(["m-a", "m-b"]);
    expect(impacts.every((impact) => impact.invalidatable)).toBe(true);
    expect(impacts[0]!.description).toContain("作废并重建");
  });

  it("swiss: keeps finished/started downstream matches as blocking facts", () => {
    const impacts = classifyDownstreamManagedMatches(
      [started(scheduledRound(2, "a")), started(scheduledRound(2, "b"), "finished")],
      { id: "source", round: 1, entryRound: null },
      "swiss",
    );
    expect(impacts).toHaveLength(2);
    expect(impacts.every((impact) => !impact.invalidatable)).toBe(true);
    expect(impacts[0]!.description).toContain("禁止自动改写");
  });

  it("playoff: orders by elimination step and ignores the bronze match", () => {
    const qf: DownstreamCandidate = { id: "qf1", managedKey: "qf-1", entryRound: "quarterfinal", round: null, status: "scheduled" };
    const sf: DownstreamCandidate = { id: "sf1", managedKey: "sf-1", entryRound: "semifinal", round: null, status: "scheduled" };
    const finalRow: DownstreamCandidate = { id: "f1", managedKey: "f-1", entryRound: "final", round: null, status: "scheduled" };
    const third: DownstreamCandidate = { id: "t1", managedKey: "t-1", entryRound: "third_place", round: null, status: "scheduled" };

    const fromQf = classifyDownstreamManagedMatches([qf, sf, finalRow, third], { id: "source", round: null, entryRound: "quarterfinal" }, "single_elim");
    expect(fromQf.map((impact) => impact.matchId).sort()).toEqual(["f1", "sf1"]);

    const fromSf = classifyDownstreamManagedMatches([sf, finalRow], { id: "sf1-source", round: null, entryRound: "semifinal" }, "single_elim");
    expect(fromSf.map((impact) => impact.matchId)).toEqual(["f1"]);

    const upstreamOnly = classifyDownstreamManagedMatches([qf], { id: "final-source", round: null, entryRound: "final" }, "single_elim");
    expect(upstreamOnly).toEqual([]);
  });

  it("never returns the corrected match itself as downstream", () => {
    const impacts = classifyDownstreamManagedMatches(
      [{ id: "self", managedKey: "r1-1", entryRound: null, round: 1, status: "scheduled" }],
      { id: "self", round: 1, entryRound: null },
      "swiss",
    );
    expect(impacts).toHaveLength(0);
  });
});

describe("deriveSwissFinalizedRollback", () => {
  it("rolls back to just before the corrected round", () => {
    expect(deriveSwissFinalizedRollback(3, 2)).toBe(1);
    // Correcting an accepted round-1 result must revoke its acceptance too.
    expect(deriveSwissFinalizedRollback(1, 1)).toBe(0);
    expect(deriveSwissFinalizedRollback(5, 1)).toBe(0);
  });

  it("reports no rollback only when nothing beyond the correction was accepted", () => {
    expect(deriveSwissFinalizedRollback(0, 1)).toBeNull();
    expect(deriveSwissFinalizedRollback(0, 4)).toBeNull();
  });

  it("treats unknown rounds conservatively", () => {
    expect(deriveSwissFinalizedRollback(2, null)).toBe(0);
  });
});

describe("validateResultCorrectionProposal", () => {
  it("accepts a legal BO1 13:x score and resolves the winner", () => {
    const result = validateResultCorrectionProposal(baseMatch(), { scoreA: 13, scoreB: 9 });
    expect(result.winnerTeamId).toBe(TEAM_A);
    expect(result.isForfeit).toBe(false);
  });

  it("resolves a B-side winner", () => {
    const result = validateResultCorrectionProposal(baseMatch(), { scoreA: 4, scoreB: 13 });
    expect(result.winnerTeamId).toBe(TEAM_B);
  });

  it("rejects negative and non-integer scores", () => {
    expect(() => validateResultCorrectionProposal(baseMatch(), { scoreA: -1, scoreB: 13 })).toThrow(AppError);
    expect(() => validateResultCorrectionProposal(baseMatch(), { scoreA: 12.5, scoreB: 13 })).toThrow(AppError);
  });

  it("rejects ties", () => {
    expect(() => validateResultCorrectionProposal(baseMatch(), { scoreA: 9, scoreB: 9 })).toThrow(/平局/);
  });

  it("enforces exact series thresholds for non-forfeit corrections", () => {
    const bo3 = { ...baseMatch(), format: "bo3" as const };
    // Winner must have exactly maxWins; 3:0 is legal for bo3, 2:1 legal, 13:x not.
    expect(validateResultCorrectionProposal(bo3, { scoreA: 2, scoreB: 0 }).winnerTeamId).toBe(TEAM_A);
    expect(() => validateResultCorrectionProposal(bo3, { scoreA: 5, scoreB: 3 })).toThrow(AppError);
  });

  it("requires the canonical forfeit shape when marked as forfeit", () => {
    expect(
      validateResultCorrectionProposal(baseMatch(), { scoreA: 13, scoreB: 0, isForfeit: true }).isForfeit,
    ).toBe(true);
    expect(() =>
      validateResultCorrectionProposal(baseMatch(), { scoreA: 16, scoreB: 3, isForfeit: true }),
    ).toThrow(/弃赛判负的标准比分为 13:0/);
    const bo3 = { ...baseMatch(), format: "bo3" as const };
    expect(() =>
      validateResultCorrectionProposal(bo3, { scoreA: 1, scoreB: 2, isForfeit: false }),
    ).not.toThrow();
    expect(() =>
      validateResultCorrectionProposal(bo3, { scoreA: 1, scoreB: 2, isForfeit: true }),
    ).toThrow(/标准比分为 2:0/);
  });

  it("inherits forfeit semantics from the existing fact when the proposal omits the flag", () => {
    const forfeited = { ...baseMatch(), isForfeit: true };
    expect(() => validateResultCorrectionProposal(forfeited, { scoreA: 7, scoreB: 13 })).toThrow(/弃赛判负/);
  });
});

describe("resolveWinnerTeamId", () => {
  it("returns null while scores are missing or tied", () => {
    expect(resolveWinnerTeamId({ teamAId: TEAM_A, teamBId: TEAM_B, scoreA: null, scoreB: null })).toBeNull();
    expect(resolveWinnerTeamId({ teamAId: TEAM_A, teamBId: TEAM_B, scoreA: 2, scoreB: 2 })).toBeNull();
  });

  it("picks the higher-score side", () => {
    expect(resolveWinnerTeamId({ teamAId: TEAM_A, teamBId: TEAM_B, scoreA: 2, scoreB: 1 })).toBe(TEAM_A);
    expect(resolveWinnerTeamId({ teamAId: TEAM_A, teamBId: TEAM_B, scoreA: 0, scoreB: 3 })).toBe(TEAM_B);
  });
});

describe("loadFrozenRunFacts", () => {
  function stageRunOf(ruleSnapshot: unknown): Pick<MajorStageRun, "stageKey" | "ruleSnapshot" | "finalizedRound"> {
    return { stageKey: "stage1", ruleSnapshot: ruleSnapshot as never, finalizedRound: 3 };
  }

  it("extracts the frozen stage type and ordered stage plan keys", () => {
    const facts = loadFrozenRunFacts(stageRunOf({
      version: 2,
      stage: { key: "stage1", type: "swiss", teamCount: 16, matchFormat: "bo1" },
      stagePlan: [{ key: "stage1" }, { key: "stage2" }, { key: "playoff" }],
    }));
    expect(facts.stageType).toBe("swiss");
    expect(facts.stagePlanKeys).toEqual(["stage1", "stage2", "playoff"]);
    expect(facts.finalizedRoundValue).toBe(3);
  });

  it("accepts single_elim snapshots", () => {
    const facts = loadFrozenRunFacts({
      stageKey: "playoff",
      finalizedRound: 0,
      ruleSnapshot: {
        stage: { key: "playoff", type: "single_elim", teamCount: 8 },
        stagePlan: [{ key: "stage1" }, { key: "playoff" }],
      },
    } as never);
    expect(facts.stageType).toBe("single_elim");
  });

  it("throws on missing/mismatched/unknown snapshot shapes", () => {
    expect(() => loadFrozenRunFacts(stageRunOf(null))).toThrow(AppError);
    expect(() =>
      loadFrozenRunFacts(stageRunOf({ stage: { key: "other", type: "swiss" }, stagePlan: [] })),
    ).toThrow(AppError);
    expect(() =>
      loadFrozenRunFacts(stageRunOf({ stage: { key: "stage1", type: "round_robin" }, stagePlan: [] })),
    ).toThrow(AppError);
  });
});
