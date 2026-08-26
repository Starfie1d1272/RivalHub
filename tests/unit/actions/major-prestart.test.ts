import { describe, expect, it, vi } from "vitest";
import { ErrorCode } from "@/lib/errors";

vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  addMajorPrestartEntrant,
  addMajorPrestartIssue,
  confirmMajorPrestartRoster,
  confirmMajorTournamentSeeds,
  lockMajorPrestartEntrants,
  removeMajorPrestartEntrant,
  resolveMajorPrestartIssue,
  saveMajorPrestartRoster,
  saveMajorTournamentSeeds,
} from "@/actions/major-prestart";

describe("Major prestart actions input boundary", () => {
  it("fails closed before any database access for malformed entrant and roster input", async () => {
    await expect(addMajorPrestartEntrant({ seasonId: "bad", teamId: "bad" })).resolves.toMatchObject({
      success: false, error: { code: ErrorCode.VALIDATION_FAILED },
    });
    await expect(removeMajorPrestartEntrant({ seasonId: "bad", entrantId: "bad" })).resolves.toMatchObject({
      success: false, error: { code: ErrorCode.VALIDATION_FAILED },
    });
    await expect(saveMajorPrestartRoster({ seasonId: "bad", entrantId: "bad", userIds: [] })).resolves.toMatchObject({
      success: false, error: { code: ErrorCode.VALIDATION_FAILED },
    });
    await expect(confirmMajorPrestartRoster({ seasonId: "bad", entrantId: "bad" })).resolves.toMatchObject({
      success: false, error: { code: ErrorCode.VALIDATION_FAILED },
    });
  });

  it("rejects malformed unresolved-work, lock, and independent-seed inputs", async () => {
    await expect(addMajorPrestartIssue({ seasonId: "bad", category: "qualification", label: "" })).resolves.toMatchObject({
      success: false, error: { code: ErrorCode.VALIDATION_FAILED },
    });
    await expect(resolveMajorPrestartIssue({ seasonId: "bad", issueId: "bad" })).resolves.toMatchObject({
      success: false, error: { code: ErrorCode.VALIDATION_FAILED },
    });
    await expect(lockMajorPrestartEntrants({ seasonId: "bad" })).resolves.toMatchObject({
      success: false, error: { code: ErrorCode.VALIDATION_FAILED },
    });
    await expect(saveMajorTournamentSeeds({ seasonId: "bad", teamIds: [] })).resolves.toMatchObject({
      success: false, error: { code: ErrorCode.VALIDATION_FAILED },
    });
    await expect(confirmMajorTournamentSeeds({ seasonId: "bad" })).resolves.toMatchObject({
      success: false, error: { code: ErrorCode.VALIDATION_FAILED },
    });
  });
});
