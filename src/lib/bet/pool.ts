export interface PoolPosition {
  accountId: string;
  optionId: string;
  stake: bigint;
}
/** Integer, no-rake pari-mutuel settlement. Stable largest remainder per account. */
export function distributePool(
  positions: readonly PoolPosition[],
  winningOptionIds: readonly string[] | null,
): Map<string, bigint> {
  const aggregate = new Map<string, PoolPosition>();
  for (const p of positions) {
    if (p.stake <= BigInt(0)) throw new Error("Stake must be positive");
    const prev = aggregate.get(p.accountId);
    if (prev && prev.optionId !== p.optionId) throw new Error("Cannot stake on multiple options");
    aggregate.set(p.accountId, {
      ...p,
      stake: p.stake + (prev?.stake ?? BigInt(0)),
    });
  }
  const rows = [...aggregate.values()];
  const total = rows.reduce((n, p) => n + p.stake, BigInt(0));
  const winners = rows.filter((p) => winningOptionIds?.includes(p.optionId));
  const winningPool = winners.reduce((n, p) => n + p.stake, BigInt(0));
  if (!winningOptionIds?.length || winningPool === BigInt(0) || winningPool === total)
    return new Map(rows.map((p) => [p.accountId, p.stake]));
  const losingPool = total - winningPool;
  const parts = winners.map((p) => ({
    ...p,
    payout: p.stake + (p.stake * losingPool) / winningPool,
    remainder: (p.stake * losingPool) % winningPool,
  }));
  parts.sort((a, b) =>
    a.remainder === b.remainder
      ? a.accountId < b.accountId
        ? -1
        : 1
      : a.remainder > b.remainder
        ? -1
        : 1,
  );
  let remainder = total - parts.reduce((n, p) => n + p.payout, BigInt(0));
  for (const p of parts)
    if (remainder > BigInt(0)) {
      p.payout++;
      remainder--;
    }
  return new Map(
    rows.map((p) => [
      p.accountId,
      parts.find((w) => w.accountId === p.accountId)?.payout ?? BigInt(0),
    ]),
  );
}
