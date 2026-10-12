import type { CompetitionQualificationRun } from "@/db/schema/competition-qualification";

/** Play-in runs belong to registration, before the Main Event lifecycle starts. */
export function isActiveCompetitionQualificationRun(
  season: { id: string; status: string },
  runId: string,
  run: Pick<CompetitionQualificationRun, "id" | "seasonId" | "startedAt" | "completedAt"> | undefined,
): boolean {
  return season.status === "registration" && run?.id === runId && run.seasonId === season.id
    && run.startedAt !== null && run.completedAt === null;
}
