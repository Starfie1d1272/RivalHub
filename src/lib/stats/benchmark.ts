import { getDynamicRankingFloor, isRankingEligible, type DynamicRankingFloor } from "./ranking";

export interface MetricBenchmarkObservation {
  value: number | null | undefined;
  sample: number | null | undefined;
}

export interface MetricBenchmark {
  floor: DynamicRankingFloor;
  qualifiedValues: readonly number[];
}

export interface MetricBenchmarkProjection {
  percentile: number;
  score: number;
  status: "qualified" | "limited";
  floor: number;
  qualifiedCount: number;
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function lowerBound(values: readonly number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (values[mid]! < target) low = mid + 1;
    else high = mid;
  }
  return low;
}

function upperBound(values: readonly number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (values[mid]! <= target) low = mid + 1;
    else high = mid;
  }
  return low;
}

/**
 * Builds one stable scoring reference from the same dynamic sample rule used
 * by StatsDataTable. Limited observations never shape the benchmark.
 */
export function buildMetricBenchmark(
  observations: readonly MetricBenchmarkObservation[],
): MetricBenchmark | null {
  const valid = observations.flatMap((row) => (
    isFiniteNumber(row.value) ? [{ value: row.value, sample: row.sample }] : []
  ));
  const floor = getDynamicRankingFloor(valid.map((row) => row.sample));
  if (!floor) return null;

  const qualifiedValues = valid
    .filter((row) => isRankingEligible(row.sample, floor.floor))
    .map((row) => row.value)
    .sort((left, right) => left - right);

  if (qualifiedValues.length === 0) return null;
  return { floor, qualifiedValues };
}

/**
 * Projects any valid observation onto a benchmark defined only by qualified
 * samples. Limited observations still receive the same score, but remain
 * explicitly marked limited and must not enter official ranking populations.
 */
export function projectMetricBenchmarkScore(
  observation: MetricBenchmarkObservation,
  benchmark: MetricBenchmark,
): MetricBenchmarkProjection | null {
  if (!isFiniteNumber(observation.value) || benchmark.qualifiedValues.length === 0) return null;

  const lower = lowerBound(benchmark.qualifiedValues, observation.value);
  const upper = upperBound(benchmark.qualifiedValues, observation.value);
  const equal = upper - lower;
  const percentile = (lower + equal / 2) / benchmark.qualifiedValues.length;

  return {
    percentile,
    score: Math.round(percentile * 100),
    status: isRankingEligible(observation.sample, benchmark.floor.floor) ? "qualified" : "limited",
    floor: benchmark.floor.floor,
    qualifiedCount: benchmark.qualifiedValues.length,
  };
}
