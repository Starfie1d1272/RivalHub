import { describe, expect, it } from "vitest";
import type { TxDb } from "@/db/client";
import { ErrorCode } from "@/lib/errors";
import { saveCompetitionEntryRosterInTx } from "./commands";
import { normalizePerfectTeamId } from "./perfect-team-id";

describe("normalizePerfectTeamId", () => {
  it("keeps only persisted ASCII numeric IDs in the compatibility read model", () => {
    expect(normalizePerfectTeamId(null)).toBeNull();
    expect(normalizePerfectTeamId("")).toBeNull();
    expect(normalizePerfectTeamId("123456")).toBe("123456");
    expect(normalizePerfectTeamId("队伍123")).toBeNull();
    expect(normalizePerfectTeamId("123 456")).toBeNull();
    expect(normalizePerfectTeamId("1".repeat(129))).toBeNull();
  });

  it("rejects an invalid direct command value before starting a roster mutation", async () => {
    await expect(saveCompetitionEntryRosterInTx({} as TxDb, {
      entryId: "entry-1",
      userIds: ["user-1"],
      primaryStarterUserIds: ["user-1"],
      perfectTeamId: "team-1",
      userId: "user-1",
      actorId: "user-1",
    })).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
  });
});
