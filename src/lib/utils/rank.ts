import { RANK_ORDER } from "@/lib/validators/registration";

/** Sort players by peakRank → peakRating → currentRank → currentRating (DESC) */
export function sortByRank<T extends { peakRank: string | null; peakRating: number | null; currentRank?: string | null; currentRating?: number | null }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const rankA = RANK_ORDER.indexOf(a.peakRank as (typeof RANK_ORDER)[number]);
    const rankB = RANK_ORDER.indexOf(b.peakRank as (typeof RANK_ORDER)[number]);
    if (rankA !== rankB) return rankB - rankA;
    if (a.peakRating !== b.peakRating) return (b.peakRating ?? -1) - (a.peakRating ?? -1);

    const curRankA = a.currentRank ? RANK_ORDER.indexOf(a.currentRank as (typeof RANK_ORDER)[number]) : -1;
    const curRankB = b.currentRank ? RANK_ORDER.indexOf(b.currentRank as (typeof RANK_ORDER)[number]) : -1;
    if (curRankA !== curRankB) return curRankB - curRankA;
    return (b.currentRating ?? -1) - (a.currentRating ?? -1);
  });
}
