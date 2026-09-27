export type StatsSortDirection = "asc" | "desc";

export type StatsSortValue = number | string | null | undefined;

/** Compare nullable stats values while keeping missing observations last. */
export function compareStatsValues(
  left: StatsSortValue,
  right: StatsSortValue,
  direction: StatsSortDirection = "desc",
): number {
  const leftMissing = left === null || left === undefined;
  const rightMissing = right === null || right === undefined;
  if (leftMissing || rightMissing) {
    if (leftMissing && rightMissing) return 0;
    return leftMissing ? 1 : -1;
  }

  const comparison = typeof left === "number" && typeof right === "number"
    ? left - right
    : String(left).localeCompare(String(right), "zh-CN", { numeric: true, sensitivity: "base" });
  return direction === "asc" ? comparison : -comparison;
}

export interface StatsSortRule<T> {
  getValue: (row: T) => StatsSortValue;
  direction?: StatsSortDirection;
}

export function sortStatsRows<T>(rows: readonly T[], primary: StatsSortRule<T>, tieBreakers: readonly StatsSortRule<T>[] = []): T[] {
  return [...rows].sort((left, right) => {
    const comparison = compareStatsValues(primary.getValue(left), primary.getValue(right), primary.direction);
    if (comparison !== 0) return comparison;
    for (const tieBreaker of tieBreakers) {
      const tie = compareStatsValues(tieBreaker.getValue(left), tieBreaker.getValue(right), tieBreaker.direction);
      if (tie !== 0) return tie;
    }
    return 0;
  });
}
