/** Statistics owns the versioned facts written by its current and rollback producers. */
export interface StatisticsProjectionContract {
  current: string;
  previous: string;
}

export function readStatisticsProjectionContract(value: unknown): StatisticsProjectionContract {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid statistics projection contract");
  const contract = value as Record<string, unknown>;
  if (
    Object.keys(contract).length !== 2 ||
    typeof contract.current !== "string" ||
    !contract.current.trim() ||
    typeof contract.previous !== "string" ||
    !contract.previous.trim() ||
    contract.current !== contract.current.trim() ||
    contract.previous !== contract.previous.trim() ||
    contract.current === contract.previous
  )
    throw new Error("Invalid statistics projection contract");
  return { current: contract.current, previous: contract.previous };
}

/** Missing/unknown contracts require the protected backfill and coverage gate. */
export function statisticsProjectionContractChanged(
  previous: unknown,
  candidate: unknown,
): boolean {
  try {
    const before = readStatisticsProjectionContract(previous);
    const after = readStatisticsProjectionContract(candidate);
    return before.current !== after.current || before.previous !== after.previous;
  } catch {
    return true;
  }
}
