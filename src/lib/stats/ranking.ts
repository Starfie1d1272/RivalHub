export interface DynamicRankingFloor {
  floor: number;
  reference: number;
  quantile: number;
  share: number;
}

export function getDynamicRankingFloor(
  samples: readonly (number | null | undefined)[],
  quantile = 0.75,
  share = 0.25,
): DynamicRankingFloor | null {
  const values = samples
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right);
  if (values.length === 0) return null;

  const clampedQuantile = Math.max(0, Math.min(1, quantile));
  const rank = Math.max(1, Math.ceil(values.length * clampedQuantile));
  const reference = values[Math.min(values.length - 1, rank - 1)]!;
  return {
    floor: Math.max(1, Math.ceil(reference * share)),
    reference,
    quantile: clampedQuantile,
    share,
  };
}

export function isRankingEligible(sample: number | null | undefined, floor: number): boolean {
  return typeof sample === "number" && Number.isFinite(sample) && sample >= floor;
}

/** Shared eligibility projection; sorting and display remain consumer concerns. */
export function partitionRankingPopulation<T>(
  rows: readonly T[],
  valueFor: (row: T) => unknown,
  sampleFor: (row: T) => number | null | undefined,
  baseline: readonly T[] = rows,
) {
  const hasValue = (row: T) => valueFor(row) !== null && valueFor(row) !== undefined;
  const dynamicFloor = getDynamicRankingFloor(baseline.map((row) => hasValue(row) ? sampleFor(row) : null));
  const ranked: T[] = [];
  const limited: T[] = [];
  for (const row of rows) {
    if (dynamicFloor && hasValue(row) && isRankingEligible(sampleFor(row), dynamicFloor.floor)) ranked.push(row);
    else limited.push(row);
  }
  return { dynamicFloor, ranked, limited };
}
