import { and, eq } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { competitionQualificationRuns, majorTournamentEntrants } from "@/db/schema";
import type { Season } from "@/db/schema/seasons";

/** The final adjustment window is open only for the derived Main Event set. */
export function isMajorRosterAdjustmentPhaseOpen(input: {
  registrationClosesAt: Date | null;
  qualificationConfigured: boolean;
  qualificationCompleted: boolean;
  finalEntrant: boolean;
}, now = new Date()): boolean {
  if (!input.qualificationConfigured && (!input.registrationClosesAt || now < input.registrationClosesAt)) return true;
  return input.finalEntrant && (!input.qualificationConfigured || input.qualificationCompleted);
}

export async function canSelfAdjustMajorRosterInTx(tx: TxDb, season: Season, entryId: string, now = new Date()): Promise<boolean> {
  if (season.competitionTemplate !== "major") return true;
  const [run] = await tx.select({ completedAt: competitionQualificationRuns.completedAt }).from(competitionQualificationRuns)
    .where(eq(competitionQualificationRuns.seasonId, season.id)).limit(1);
  const [entrant] = await tx.select({ id: majorTournamentEntrants.id }).from(majorTournamentEntrants)
    .where(and(eq(majorTournamentEntrants.seasonId, season.id), eq(majorTournamentEntrants.competitionEntryId, entryId))).limit(1);
  return isMajorRosterAdjustmentPhaseOpen({
    registrationClosesAt: season.registrationClosesAt,
    qualificationConfigured: Boolean(run),
    qualificationCompleted: Boolean(run?.completedAt),
    finalEntrant: Boolean(entrant),
  }, now);
}
