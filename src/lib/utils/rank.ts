import { RANK_ORDER } from "@/lib/validators/registration";

/** Sort players by peakRank (higher rank = first) then peakRating DESC */
export function sortByRank<T extends { peakRank: string; peakRating: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const rankA = RANK_ORDER.indexOf(a.peakRank as (typeof RANK_ORDER)[number]);
    const rankB = RANK_ORDER.indexOf(b.peakRank as (typeof RANK_ORDER)[number]);
    if (rankA !== rankB) return rankB - rankA;
    return b.peakRating - a.peakRating;
  });
}
