export interface TeamRatingSourceRow {
  teamId: string | null;
  avgRating: number | null;
  ratingSamples: number;
}

export interface TeamRatingRow {
  entryId: string;
  rating: number;
  ratingSamples: number;
}

export function buildTeamRatings(rows: readonly TeamRatingSourceRow[]): TeamRatingRow[] {
  const totals = new Map<string, { weightedRating: number; ratingSamples: number }>();

  for (const row of rows) {
    if (!row.teamId || row.avgRating === null || row.ratingSamples <= 0) continue;
    const current = totals.get(row.teamId) ?? { weightedRating: 0, ratingSamples: 0 };
    current.weightedRating += row.avgRating * row.ratingSamples;
    current.ratingSamples += row.ratingSamples;
    totals.set(row.teamId, current);
  }

  return [...totals].map(([entryId, total]) => ({
    entryId,
    rating: total.weightedRating / total.ratingSamples,
    ratingSamples: total.ratingSamples,
  }));
}
