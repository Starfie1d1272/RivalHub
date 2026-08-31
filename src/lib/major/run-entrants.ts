import { and, eq } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { majorStageEntrants, majorTournamentEntrants, majorTournamentSeeds } from "@/db/schema";

/** Relational source for StageRun membership; never read it from a snapshot. */
export async function loadMajorStageEntrantsInTx(tx: TxDb, stageRunId: string) {
  return tx.select({
    stageEntrantId: majorStageEntrants.id,
    stageRunId: majorStageEntrants.stageRunId,
    seasonId: majorStageEntrants.seasonId,
    tournamentEntrantId: majorStageEntrants.tournamentEntrantId,
    competitionEntryId: majorTournamentEntrants.competitionEntryId,
    tournamentSeed: majorTournamentSeeds.seed,
    stageSeed: majorStageEntrants.stageSeed,
  }).from(majorStageEntrants)
    .innerJoin(majorTournamentEntrants, eq(majorTournamentEntrants.id, majorStageEntrants.tournamentEntrantId))
    .innerJoin(majorTournamentSeeds, and(eq(majorTournamentSeeds.tournamentEntrantId, majorTournamentEntrants.id), eq(majorTournamentSeeds.seasonId, majorStageEntrants.seasonId)))
    .where(eq(majorStageEntrants.stageRunId, stageRunId)).for("update");
}

/** Canonical tournament entrants/seeds for v4 runtime decisions. */
export async function loadMajorTournamentEntrantsInTx(tx: TxDb, seasonId: string) {
  return tx.select({
    entrantId: majorTournamentEntrants.id,
    competitionEntryId: majorTournamentEntrants.competitionEntryId,
    tournamentSeed: majorTournamentSeeds.seed,
  }).from(majorTournamentEntrants)
    .innerJoin(majorTournamentSeeds, and(eq(majorTournamentSeeds.tournamentEntrantId, majorTournamentEntrants.id), eq(majorTournamentSeeds.seasonId, seasonId)))
    .where(eq(majorTournamentEntrants.seasonId, seasonId)).for("update");
}
