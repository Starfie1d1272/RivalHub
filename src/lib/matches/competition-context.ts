import { AppError, ErrorCode } from "@/lib/errors";

type Association = { seasonId: string | null; entryAId: string | null; entryBId: string | null; stage: string | null };
export type CompetitionMatch<T extends Association> = T & { seasonId: string; entryAId: string; entryBId: string; stage: string };
/** Event-only entrypoints must positively establish association before applying event policy. */
export function assertCompetitionMatch<T extends Association>(match: T): asserts match is CompetitionMatch<T> {
  if (!match.seasonId || !match.entryAId || !match.entryBId || !match.stage) throw new AppError(ErrorCode.VALIDATION_FAILED, "该操作需要赛事比赛。");
}

export function requireCompetitionMatch<T extends Association>(match: T): CompetitionMatch<T> {
  assertCompetitionMatch(match);
  return match;
}

export function isCompetitionMatch<T extends Association>(match: T): match is CompetitionMatch<T> {
  return Boolean(match.seasonId && match.entryAId && match.entryBId && match.stage);
}

/** Narrow the event columns selected by an already event-scoped query. */
export function requireCompetitionFields<T extends Partial<Association>>(row: T): T & { [K in keyof T]: K extends keyof Association ? NonNullable<T[K]> : T[K] } {
  for (const key of ["seasonId", "entryAId", "entryBId", "stage"] as const) {
    if (key in row && row[key] == null) throw new AppError(ErrorCode.VALIDATION_FAILED, "赛事比赛上下文不完整。");
  }
  return row as T & { [K in keyof T]: K extends keyof Association ? NonNullable<T[K]> : T[K] };
}
