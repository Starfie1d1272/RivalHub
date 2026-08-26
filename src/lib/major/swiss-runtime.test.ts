import { describe, expect, it } from "vitest";
import { ErrorCode } from "@/lib/errors";
import { finalizeMajorSwissRoundInTransaction } from "./swiss-runtime";

function lockedSelect(rows: unknown[]) {
  return {
    from: () => ({
      where: () => ({
        for: async () => rows,
      }),
    }),
  };
}

describe("finalizeMajorSwissRoundInTransaction", () => {
  it("rejects when the season has no StageRun", async () => {
    const tx = { select: () => lockedSelect([]) } as never;
    await expect(finalizeMajorSwissRoundInTransaction(tx, {
      seasonId: "season-1", expectedRound: 1, actorId: "admin-1",
    })).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });

  it("rejects a StageRun without an auditable frozen stage rule", async () => {
    const tx = {
      select: () => lockedSelect([{
        id: "run-1", seasonId: "season-1", stageKey: "stage1", ruleSnapshot: {}, finalizedRound: 0,
      }]),
    } as never;
    await expect(finalizeMajorSwissRoundInTransaction(tx, {
      seasonId: "season-1", expectedRound: 1, actorId: "admin-1",
    })).rejects.toMatchObject({ code: ErrorCode.INTERNAL_ERROR });
  });
});
