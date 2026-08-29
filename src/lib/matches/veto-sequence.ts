import { AppError, ErrorCode } from "@/lib/errors";
import type { VetoActionType } from "@/types/match";

export interface VetoSequenceStep {
  actionType: VetoActionType;
  teamId: string | null;
}

export function assertVetoSequence(
  format: "bo1" | "bo3" | "bo5",
  steps: readonly VetoSequenceStep[],
  teamAId: string,
  teamBId: string,
): void {
  const expected: Record<typeof format, readonly VetoActionType[]> = {
    bo1: ["ban", "ban", "ban", "ban", "ban", "ban", "decider"],
    bo3: ["ban", "ban", "pick", "pick", "ban", "ban", "decider"],
    bo5: ["ban", "ban", "pick", "pick", "pick", "pick", "decider"],
  };
  if (steps.length !== expected[format].length || steps.some((step, index) => step.actionType !== expected[format][index])) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, `${format.toUpperCase()} BP 步骤顺序不合法`);
  }
  if (steps.some((step) => step.teamId !== null && step.teamId !== teamAId && step.teamId !== teamBId)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "BP 操作队伍必须是本场任一参赛队");
  }

  const expectedTeams: Record<typeof format, readonly string[]> = {
    bo1: [teamAId, teamAId, teamBId, teamBId, teamBId, teamAId, teamBId],
    bo3: [teamAId, teamBId, teamAId, teamBId, teamBId, teamAId, teamBId],
    bo5: [teamAId, teamBId, teamAId, teamBId, teamAId, teamBId, teamBId],
  };
  if (steps.some((step, index) => step.teamId !== expectedTeams[format][index])) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, `${format.toUpperCase()} BP 操作顺序不合法`);
  }
}
