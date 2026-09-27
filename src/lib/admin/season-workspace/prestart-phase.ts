export const MAJOR_PRESTART_PHASES = ["报名收口", "资格方案", "资格赛", "正赛名单", "正赛种子", "开赛确认"] as const;

export function deriveMajorPrestartPhase(input: {
  registrationClosed: boolean;
  approvedCandidateCount: number;
  pendingReviewCount: number;
  entrantCapacity: number;
  entrantCount: number;
  qualificationConfigured: boolean;
  qualificationCompleted: boolean;
  entrantsLocked: boolean;
  seedsConfirmed: boolean;
}): 1 | 2 | 3 | 4 | 5 | 6 {
  if (input.entrantsLocked) return input.seedsConfirmed ? 6 : 5;
  if (input.qualificationConfigured) return input.qualificationCompleted ? 4 : 3;
  if (input.entrantCount > 0) return 4;
  if (!input.registrationClosed || input.pendingReviewCount > 0 || input.approvedCandidateCount < input.entrantCapacity) return 1;
  return input.approvedCandidateCount > input.entrantCapacity ? 2 : 4;
}
