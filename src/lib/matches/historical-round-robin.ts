/**
 * Historical-only round-robin entrant recovery. Current stages must use the
 * stage-local provider metadata or another canonical entrant source.
 */
export function resolveStrictHistoricalRoundRobinEntryIds(
  teamCount: number,
  stageMatches: readonly {
    entryAId: string;
    entryBId: string;
    status: string;
  }[],
): string[] | null {
  if (!Number.isInteger(teamCount) || teamCount < 2) return null;
  const expectedMatchCount = (teamCount * (teamCount - 1)) / 2;
  const terminalMatches = stageMatches.filter((match) => match.status === "finished" || match.status === "cancelled");
  if (terminalMatches.length !== expectedMatchCount || terminalMatches.length !== stageMatches.length) return null;

  const entryIds = new Set<string>();
  const pairs = new Set<string>();
  for (const match of terminalMatches) {
    if (!match.entryAId || !match.entryBId || match.entryAId === match.entryBId) return null;
    entryIds.add(match.entryAId);
    entryIds.add(match.entryBId);
    const pair = [match.entryAId, match.entryBId].sort().join("\u0000");
    if (pairs.has(pair)) return null;
    pairs.add(pair);
  }
  if (entryIds.size !== teamCount || pairs.size !== expectedMatchCount) return null;

  return [...entryIds].sort();
}
