import { AppError, ErrorCode } from "@/lib/errors";
import type { VetoActionType } from "@/types/match";

export interface VetoSequenceStep {
  actionType: VetoActionType;
  entryId: string | null;
}

export function assertVetoSequence(
  format: "bo1" | "bo3" | "bo5",
  steps: readonly VetoSequenceStep[],
  entryAId: string,
  entryBId: string,
): void {
  const expected: Record<typeof format, readonly VetoActionType[]> = {
    bo1: ["ban", "ban", "ban", "ban", "ban", "ban", "decider"],
    bo3: ["ban", "ban", "pick", "pick", "ban", "ban", "decider"],
    bo5: ["ban", "ban", "pick", "pick", "pick", "pick", "decider"],
  };
  if (steps.length !== expected[format].length || steps.some((step, index) => step.actionType !== expected[format][index])) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, `${format.toUpperCase()} BP 步骤顺序不合法`);
  }
  if (steps.some((step) => step.entryId !== null && step.entryId !== entryAId && step.entryId !== entryBId)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "BP 操作队伍必须是本场任一参赛队");
  }

  const expectedTeams: Record<typeof format, readonly string[]> = {
    bo1: [entryAId, entryAId, entryBId, entryBId, entryBId, entryAId, entryBId],
    bo3: [entryAId, entryBId, entryAId, entryBId, entryBId, entryAId, entryBId],
    bo5: [entryAId, entryBId, entryAId, entryBId, entryAId, entryBId, entryBId],
  };
  if (steps.some((step, index) => step.entryId !== expectedTeams[format][index])) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, `${format.toUpperCase()} BP 操作顺序不合法`);
  }
}
