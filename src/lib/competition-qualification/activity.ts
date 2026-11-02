import type { Season } from "@/db/schema/seasons";
import type { CompetitionQualificationRun } from "@/db/schema/competition-qualification";

/** Play-in runs belong to registration, before the Main Event lifecycle starts. */
export function isActiveCompetitionQualificationRun(
  season: { id: string; status: string } & Partial<Pick<Season, "registrationMode" | "teamRegistrationConfig">>,
  runId: string,
  run: Pick<CompetitionQualificationRun, "id" | "seasonId" | "startedAt" | "completedAt"> | undefined,
): boolean {
  return (season.status === "registration" || (season.status === "drafting" && season.registrationMode === "solo" && season.teamRegistrationConfig?.qualificationPolicy?.version === 2)) && run?.id === runId && run.seasonId === season.id
    && run.startedAt !== null && run.completedAt === null;
}
