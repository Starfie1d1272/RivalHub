/** Freeze the pre-match observation time without assuming a schedule exists. */
export function broadcastStatsCutoff(startedAt: Date | null, scheduledAt: Date | null, generatedAt: Date) {
  if (startedAt) return { cutoffAt: startedAt, cutoffSource: "startedAt" as const };
  if (scheduledAt && scheduledAt < generatedAt) return { cutoffAt: scheduledAt, cutoffSource: "scheduledAt" as const };
  return { cutoffAt: generatedAt, cutoffSource: "generatedAt" as const };
}

/** Require complete known inputs for this player's two displayed metrics only. */
export function playerStatsAvailable(row: { maps: number; ratingSamples: number; rounds: number | null; adrRounds: number | null; avgRating: number | null; avgAdr: number | null } | undefined): boolean {
  return !!row && row.avgRating !== null && Number.isFinite(row.avgRating) && row.avgAdr !== null && Number.isFinite(row.avgAdr)
    && row.maps > 0 && row.ratingSamples === row.maps && row.rounds !== null && row.rounds > 0 && row.adrRounds === row.rounds;
}
