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
