/** A valid Rating identifies the focus player; ADR has its own sample and may be absent. */
export function playerStatsAvailable(row: { ratingSamples: number; avgRating: number | null } | undefined): boolean {
  return !!row && row.ratingSamples > 0 && row.avgRating !== null && Number.isFinite(row.avgRating);
}
