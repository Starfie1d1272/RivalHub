import { canPickPosition } from "./rules";
import { RANK_ORDER } from "@/lib/validators/registration";

export interface AutoPickCandidate {
  registrationId: string;
  primaryPosition: string;
  peakRank: string | null;
  peakRating: number | null;
  currentRank: string | null;
  currentRating: number | null;
  createdAt: Date | string;
}

export function selectAutoPickCandidate(
  candidates: AutoPickCandidate[],
  positionCounts: Record<string, number>,
  positionLimit = 2,
): AutoPickCandidate | null {
  const sorted = [...candidates].sort((a, b) => {
    const rankA = RANK_ORDER.indexOf(a.peakRank as (typeof RANK_ORDER)[number]);
    const rankB = RANK_ORDER.indexOf(b.peakRank as (typeof RANK_ORDER)[number]);
    if (rankA !== rankB) return rankB - rankA;
    if (a.peakRating !== b.peakRating) return (b.peakRating ?? -1) - (a.peakRating ?? -1);

    const curRankA = a.currentRank
      ? RANK_ORDER.indexOf(a.currentRank as (typeof RANK_ORDER)[number])
      : -1;
    const curRankB = b.currentRank
      ? RANK_ORDER.indexOf(b.currentRank as (typeof RANK_ORDER)[number])
      : -1;
    if (curRankA !== curRankB) return curRankB - curRankA;
    if (a.currentRating !== b.currentRating) return (b.currentRating ?? -1) - (a.currentRating ?? -1);

    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  // Round 1: prefer positions with zero current members (completely vacant)
  const firstPick =
    sorted.find(
      (candidate) =>
        (positionCounts[candidate.primaryPosition] ?? 0) === 0,
    ) ?? null;
  if (firstPick) return firstPick;

  // Round 2: any position below the cap (max 2 per position in draft)
  return (
    sorted.find((candidate) =>
      canPickPosition(positionCounts[candidate.primaryPosition] ?? 0, positionLimit),
    ) ?? null
  );
}

export function createAutoPickRequestId({
  seasonId,
  entryId,
  round,
  deadline,
}: {
  seasonId: string;
  entryId: string;
  round: number;
  deadline: Date | null;
}): string {
  return `auto:${seasonId}:${entryId}:${round}:${deadline?.getTime() ?? "no-deadline"}`;
}
