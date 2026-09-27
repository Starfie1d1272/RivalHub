/** The human decision is authoritative after Qualification has been configured. */
export function initialPreliminaryOrder(
  systemOrder: readonly string[],
  savedEntrants: readonly { entryId: string; preliminarySeed: number }[] | null,
): string[] {
  return savedEntrants
    ? [...savedEntrants].sort((a, b) => a.preliminarySeed - b.preliminarySeed).map((entrant) => entrant.entryId)
    : [...systemOrder];
}

export function moveRankingEntry(order: readonly string[], entryId: string, targetRank: number): string[] {
  const from = order.indexOf(entryId);
  const to = targetRank - 1;
  if (from < 0 || !Number.isInteger(to) || to < 0 || to >= order.length || from === to) return [...order];
  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, entryId);
  return next;
}
