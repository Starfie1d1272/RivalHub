import { canPickPosition } from "./rules";
import { RANK_ORDER } from "@/lib/validators/registration";

export interface AutoPickCandidate {
  registrationId: string;
  primaryPosition: string;
  peakRank: string;
  peakRating: number;
  currentRank: string;
  currentRating: number;
  createdAt: Date;
}

export function selectAutoPickCandidate(
  candidates: AutoPickCandidate[],
  positionCounts: Record<string, number>,
): AutoPickCandidate | null {
  const sorted = [...candidates].sort((a, b) => {
    const rankA = RANK_ORDER.indexOf(a.peakRank as (typeof RANK_ORDER)[number]);
    const rankB = RANK_ORDER.indexOf(b.peakRank as (typeof RANK_ORDER)[number]);
    if (rankA !== rankB) return rankB - rankA;
    if (a.peakRating !== b.peakRating) return b.peakRating - a.peakRating;

    const curRankA = a.currentRank
      ? RANK_ORDER.indexOf(a.currentRank as (typeof RANK_ORDER)[number])
      : -1;
    const curRankB = b.currentRank
      ? RANK_ORDER.indexOf(b.currentRank as (typeof RANK_ORDER)[number])
      : -1;
    if (curRankA !== curRankB) return curRankB - curRankA;
    if (a.currentRating !== b.currentRating) return b.currentRating - a.currentRating;

    return a.createdAt.getTime() - b.createdAt.getTime();
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
      canPickPosition(positionCounts[candidate.primaryPosition] ?? 0),
    ) ?? null
  );
}

export function createAutoPickRequestId({
  seasonId,
  teamId,
  round,
  deadline,
}: {
  seasonId: string;
  teamId: string;
  round: number;
  deadline: Date | null;
}): string {
  return `auto:${seasonId}:${teamId}:${round}:${deadline?.getTime() ?? "no-deadline"}`;
}
