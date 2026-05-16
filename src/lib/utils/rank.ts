import { RANK_ORDER } from "@/lib/validators/registration";

/** Sort players by peakRank → peakRating → currentRank → currentRating (DESC) */
export function sortByRank<T extends { peakRank: string; peakRating: number; currentRank?: string; currentRating?: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const rankA = RANK_ORDER.indexOf(a.peakRank as (typeof RANK_ORDER)[number]);
    const rankB = RANK_ORDER.indexOf(b.peakRank as (typeof RANK_ORDER)[number]);
    if (rankA !== rankB) return rankB - rankA;
    if (a.peakRating !== b.peakRating) return b.peakRating - a.peakRating;

    const curRankA = a.currentRank ? RANK_ORDER.indexOf(a.currentRank as (typeof RANK_ORDER)[number]) : -1;
    const curRankB = b.currentRank ? RANK_ORDER.indexOf(b.currentRank as (typeof RANK_ORDER)[number]) : -1;
    if (curRankA !== curRankB) return curRankB - curRankA;
    return (b.currentRating ?? 0) - (a.currentRating ?? 0);
  });
}
