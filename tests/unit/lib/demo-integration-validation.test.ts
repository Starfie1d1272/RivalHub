import { beforeEach, describe, expect, it, vi } from "vitest";
import { hasConfirmableParticipantIdentityIssue, loadCanonicalTarget, CanonicalTargetUnavailableError } from "@/lib/demo-integration/validation";

describe("Demo participant identity issue projection", () => {
  it("only projects the exact unresolved participant path as confirmable", () => {
    const participantA = "76561198000000001";
    const participantB = "76561198000000002";

    const issues = [
      {
        code: "PARTICIPANT_IDENTITY_UNRESOLVED",
        path: `participants.${participantA}`,
        message: "选手身份未能以 Steam64 唯一匹配，不能自动接收。",
      },
      {
        code: "PARTICIPANT_NOT_IN_ROSTER",
        path: `participants.${participantB}`,
        message: "Demo Steam64 不属于本场已确认首发名单。",
      },
    ];

    expect(hasConfirmableParticipantIdentityIssue(issues, participantA)).toBe(true);
    expect(hasConfirmableParticipantIdentityIssue(issues, participantB)).toBe(false);
    expect(hasConfirmableParticipantIdentityIssue(issues, "76561198000000003")).toBe(false);
  });
});

// Only the target reader's explicit unavailable outcomes are business failures;
// matching AppError codes from a dependent roster reader are not sufficient.
const roster = vi.hoisted(() => vi.fn());
vi.mock("@/lib/match-rosters/effective", () => ({ loadEffectiveMatchRoster: roster }));
import { AppError, ErrorCode } from "@/lib/errors";

const target = { seasonId: "season", matchId: "match", matchMapId: "map" };
function targetReader(matchRows: unknown[], mapRows: unknown[]) {
  return { select: vi.fn()
    .mockReturnValueOnce({ from: () => ({ where: () => ({ for: async () => matchRows }) }) })
    .mockReturnValueOnce({ from: () => ({ where: async () => mapRows }) }) } as unknown as Parameters<typeof loadCanonicalTarget>[0];
}
const match = { id: "match", seasonId: "season", entryAId: "a", entryBId: "b", stage: "stage" };
beforeEach(() => { roster.mockReset(); });
it.each([
  [[], [], ErrorCode.NOT_FOUND],
  [[match], [], ErrorCode.NOT_FOUND],
  [[{ ...match, entryAId: null }], [], ErrorCode.VALIDATION_FAILED],
])("marks only an explicitly unavailable canonical target", async (matches, maps, code) => {
  const result = loadCanonicalTarget(targetReader(matches as unknown[], maps as unknown[]), target);
  await expect(result).rejects.toBeInstanceOf(CanonicalTargetUnavailableError);
  await expect(result).rejects.toMatchObject({ code });
  expect(roster).not.toHaveBeenCalled();
});
it("does not relabel a dependent reader's AppError as a missing target", async () => {
  const error = new AppError(ErrorCode.NOT_FOUND, "unexpected dependent owner failure");
  roster.mockRejectedValue(error);
  let caught: unknown;
  try { await loadCanonicalTarget(targetReader([match], [{ id: "map" }]), target); }
  catch (failure) { caught = failure; }
  expect(caught === error).toBe(true);
  expect(caught instanceof CanonicalTargetUnavailableError).toBe(false);
});
