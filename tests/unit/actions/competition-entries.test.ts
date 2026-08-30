import { describe, expect, it, vi } from "vitest";
import { ErrorCode } from "@/lib/errors";

vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  createCompetitionEntry,
  declineCompetitionEntryParticipation,
  requestCompetitionEntryRosterChange,
  saveCompetitionEntryRoster,
  submitCompetitionEntry,
  withdrawCompetitionEntry,
} from "@/actions/competition-entries";

describe("CompetitionEntry action input boundary", () => {
  it("rejects malformed Entry identity before database access", async () => {
    await expect(saveCompetitionEntryRoster({ entryId: "bad", userIds: [], primaryStarterUserIds: [] })).resolves.toMatchObject({
      success: false,
      error: { code: ErrorCode.VALIDATION_FAILED },
    });
    await expect(submitCompetitionEntry({ entryId: "bad" })).resolves.toMatchObject({
      success: false,
      error: { code: ErrorCode.VALIDATION_FAILED },
    });
    await expect(withdrawCompetitionEntry({ entryId: "bad" })).resolves.toMatchObject({
      success: false,
      error: { code: ErrorCode.VALIDATION_FAILED },
    });
    await expect(requestCompetitionEntryRosterChange({ entryId: "bad" })).resolves.toMatchObject({
      success: false,
      error: { code: ErrorCode.VALIDATION_FAILED },
    });
  });

  it("rejects malformed participant and linked-Team input", async () => {
    await expect(declineCompetitionEntryParticipation({ entryId: "bad" })).resolves.toMatchObject({
      success: false,
      error: { code: ErrorCode.VALIDATION_FAILED },
    });
    await expect(createCompetitionEntry({ competitionId: "bad", teamId: "bad" })).resolves.toMatchObject({
      success: false,
      error: { code: ErrorCode.VALIDATION_FAILED },
    });
  });
});
