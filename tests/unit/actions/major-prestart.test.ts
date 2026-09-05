import { describe, expect, it, vi } from "vitest";
import { ErrorCode } from "@/lib/errors";

vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));

import {
  addMajorPrestartIssue,
  confirmMajorPrestartRoster,
  confirmMajorTournamentSeeds,
  lockMajorPrestartEntrants,
  reopenMajorPrestartRoster,
  resolveMajorPrestartIssue,
  repairMajorPrestartRoster,
  saveMajorTournamentSeeds,
  selectMajorEntrants,
  startMajor,
} from "@/actions/major-prestart";

describe("Major prestart actions input boundary", () => {
  it("fails closed before any database access for malformed entrant and roster input", async () => {
    await expect(selectMajorEntrants({ seasonId: "bad", competitionEntryIds: [] })).resolves.toMatchObject({
      success: false, error: { code: ErrorCode.VALIDATION_FAILED },
    });
    await expect(repairMajorPrestartRoster({ seasonId: "bad", entrantId: "bad", userIds: [], reason: "" })).resolves.toMatchObject({
      success: false, error: { code: ErrorCode.VALIDATION_FAILED },
    });
    await expect(confirmMajorPrestartRoster({ seasonId: "bad", entrantId: "bad", reason: "" })).resolves.toMatchObject({
      success: false, error: { code: ErrorCode.VALIDATION_FAILED },
    });
    await expect(reopenMajorPrestartRoster({ seasonId: "bad", entrantId: "bad", reason: "" })).resolves.toMatchObject({
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
    await expect(saveMajorTournamentSeeds({ seasonId: "bad", entryIds: [] })).resolves.toMatchObject({
      success: false, error: { code: ErrorCode.VALIDATION_FAILED },
    });
    await expect(confirmMajorTournamentSeeds({ seasonId: "bad" })).resolves.toMatchObject({
      success: false, error: { code: ErrorCode.VALIDATION_FAILED },
    });
    await expect(startMajor({ seasonId: "bad" })).resolves.toMatchObject({
      success: false, error: { code: ErrorCode.VALIDATION_FAILED },
    });
  });

  it("rejects a duplicate final entrant selection at the action boundary", async () => {
    await expect(selectMajorEntrants({
      seasonId: "00000000-0000-4000-8000-000000000001",
      competitionEntryIds: [
        "00000000-0000-4000-8000-000000000002",
        "00000000-0000-4000-8000-000000000002",
      ],
    })).resolves.toMatchObject({
      success: false, error: { code: ErrorCode.VALIDATION_FAILED },
    });
  });
});
