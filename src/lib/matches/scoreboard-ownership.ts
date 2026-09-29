/** OCR owns operator-confirmed Rating/RWS/WE enrichment; DAK owns gameplay facts. */
export function applyOcrScoreboardEnrichment(
  prior: { dakImportId: string | null; ratingPro: number | null; rws: number | null; we: number | null },
  incoming: { ratingPro: number | null; rws: number | null; we: number | null },
) {
  return {
    ratingPro: prior.dakImportId ? incoming.ratingPro ?? prior.ratingPro : incoming.ratingPro,
    rws: prior.dakImportId ? incoming.rws ?? prior.rws : incoming.rws,
    we: prior.dakImportId ? incoming.we ?? prior.we : incoming.we,
  };
}
