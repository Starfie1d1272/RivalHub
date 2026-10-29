/** Require complete known inputs for this player's two displayed metrics only. */
export function playerStatsAvailable(row: { maps: number; ratingSamples: number; rounds: number | null; adrRounds: number | null; avgRating: number | null; avgAdr: number | null } | undefined): boolean {
  return !!row && row.avgRating !== null && Number.isFinite(row.avgRating) && row.avgAdr !== null && Number.isFinite(row.avgAdr)
    && row.maps > 0 && row.ratingSamples === row.maps && row.rounds !== null && row.rounds > 0 && row.adrRounds === row.rounds;
}
