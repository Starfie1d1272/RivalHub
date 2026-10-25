import { expect, it } from "vitest";
import { canConfirmCommentaryRoster } from "@/lib/postmatch/commentary-policy";

it("keeps confirmation finished-only and nonempty, with a narrow reopened super-admin exception", () => {
  const facts = { status: "finished" as const, commentatorCount: 1, isCommentator: false, isSuperAdmin: true, rosterReopened: true };
  expect(canConfirmCommentaryRoster(facts)).toBe(true);
  expect(canConfirmCommentaryRoster({ ...facts, commentatorCount: 2 })).toBe(true);
  expect(canConfirmCommentaryRoster({ ...facts, commentatorCount: 0 })).toBe(false);
  expect(canConfirmCommentaryRoster({ ...facts, rosterReopened: false })).toBe(false);
  expect(canConfirmCommentaryRoster({ ...facts, isSuperAdmin: false })).toBe(false);
  expect(canConfirmCommentaryRoster({ ...facts, isSuperAdmin: false, isCommentator: true })).toBe(true);
  for (const status of ["scheduled", "in_progress", "cancelled"] as const) {
    expect(canConfirmCommentaryRoster({ ...facts, status })).toBe(false);
  }
});
