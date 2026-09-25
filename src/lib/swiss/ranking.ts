import type { SwissRecord } from "./types";

export interface SwissRankFacts extends SwissRecord {
  buchholz: number;
  initialSeed: number;
}

/** Recompute Valve-style Buchholz from the opponents' current projected records. */
export function computeValveBuchholzScore(
  opponents: readonly string[],
  records: ReadonlyMap<string, SwissRecord>,
): number {
  return opponents.reduce((score, opponentId) => {
    const record = records.get(opponentId);
    if (!record) throw new Error(`missing Swiss opponent record: ${opponentId}`);
    return score + record.wins - record.losses;
  }, 0);
}

/** Shared deterministic Swiss order: W DESC, L ASC, BU DESC, initial seed ASC. */
export function compareSwissRanking(a: SwissRankFacts, b: SwissRankFacts): number {
  return b.wins - a.wins ||
    a.losses - b.losses ||
    b.buchholz - a.buchholz ||
    a.initialSeed - b.initialSeed;
}
