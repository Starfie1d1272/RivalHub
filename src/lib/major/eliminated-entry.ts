import "server-only";
import { and, count, eq } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { competitionQualificationEntrants, competitionQualificationRuns, majorPrestartStates, majorTournamentEntrants } from "@/db/schema";
import type { Season } from "@/db/schema/seasons";
import { resolveManagedMajorProfile } from "@/lib/competition/definition";
import { canSelfChangeApprovedRoster } from "@/lib/registration/window";

type TransferSeason = Pick<Season, "id" | "competitionTemplate" | "stagePlan" | "status" | "registrationOpensAt" | "registrationOpenedAt" | "registrationClosesAt" | "rosterChangeClosesAt">;

type Reader = Pick<TxDb, "select">;
/** Elimination belongs to the completed qualification and complete official set. */
export async function isEliminatedMajorEntryInTx(tx: Reader, season: TransferSeason, entryId: string): Promise<boolean> {
  if (season.competitionTemplate !== "major") return false;
  const capacity = resolveManagedMajorProfile({ stagePlan: season.stagePlan })?.entrantCapacity;
  if (!capacity) return false;
  const [run] = await tx.select({ id: competitionQualificationRuns.id, completedAt: competitionQualificationRuns.completedAt }).from(competitionQualificationRuns).where(eq(competitionQualificationRuns.seasonId, season.id)).limit(1);
  if (!run?.completedAt) return false;
  const [candidate] = await tx.select({ id: competitionQualificationEntrants.id }).from(competitionQualificationEntrants).where(and(eq(competitionQualificationEntrants.runId, run.id), eq(competitionQualificationEntrants.competitionEntryId, entryId))).limit(1);
  if (!candidate) return false;
  const [total] = await tx.select({ value: count() }).from(majorTournamentEntrants).where(eq(majorTournamentEntrants.seasonId, season.id));
  if (total?.value !== capacity) return false;
  const [entrant] = await tx.select({ id: majorTournamentEntrants.id }).from(majorTournamentEntrants).where(and(eq(majorTournamentEntrants.seasonId, season.id), eq(majorTournamentEntrants.competitionEntryId, entryId))).limit(1);
  return !entrant;
}

/** Personal release never edits the eliminated team's historical roster. */
export async function canReleaseEliminatedParticipationInTx(tx: Reader, season: TransferSeason, entryId: string, now = new Date()): Promise<boolean> {
  if (!canSelfChangeApprovedRoster(season, now)) return false;
  const [state] = await tx.select({ lockedAt: majorPrestartStates.entrantsLockedAt }).from(majorPrestartStates).where(eq(majorPrestartStates.seasonId, season.id)).limit(1);
  return !state?.lockedAt && await isEliminatedMajorEntryInTx(tx, season, entryId);
}
