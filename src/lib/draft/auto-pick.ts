import { canPickPosition } from "./rules";

export interface AutoPickCandidate {
  registrationId: string;
  primaryPosition: string;
  peakRating: number;
}

export function selectAutoPickCandidate(
  candidates: AutoPickCandidate[],
  positionCounts: Record<string, number>,
): AutoPickCandidate | null {
  return [...candidates]
    .sort(
      (a, b) =>
        b.peakRating - a.peakRating ||
        a.registrationId.localeCompare(b.registrationId),
    )
    .find((candidate) =>
      canPickPosition(positionCounts[candidate.primaryPosition] ?? 0),
    ) ?? null;
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
