import type { BroadcastMatchSupport } from "./stats-contract";

/** Mirrors the public support identity check; decimal amounts stay lossless. */
export function broadcastMatchSupport(rows: { entryId: string; amount: string }[] | null, entryIds: readonly string[]): BroadcastMatchSupport | null {
  if (!rows) return null;
  const total = rows.reduce((sum, row) => sum + BigInt(row.amount), BigInt(0));
  const amounts = entryIds.map(id => rows.find(row => row.entryId === id));
  if (amounts.some(row => !row) || amounts.reduce((sum, row) => sum + BigInt(row!.amount), BigInt(0)) !== total) return null;
  return { total: total.toString(), sides: entryIds.map((entryId, index) => ({
    entryId, amount: amounts[index]!.amount,
    ratio: total > BigInt(0) ? Number(BigInt(amounts[index]!.amount) * BigInt(1_000_000_000) / total) / 1_000_000_000 : null,
  })) };
}
