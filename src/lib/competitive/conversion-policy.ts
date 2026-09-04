import { isBuiltInStarRank } from "@/lib/competitive/builtins";

/** One piecewise-linear star→rank segment of a 5E→Perfect S-tier conversion. */
export interface StarSegment {
  /** Inclusive 5E total-star lower bound. */
  minStar: number;
  /** Inclusive upper bound; null means open-ended. */
  maxStar: number | null;
  /** Target Perfect rank key. */
  targetRank: string;
  /** Target Perfect star floor; null when the target is below-S (starless). */
  targetStarFloor: number | null;
  slopeNum: number;
  slopeDen: number;
}

/** The auditable content of one conversion policy version. */
export interface ConversionPolicyMapping {
  /** 5E below-S rank → Perfect below-S rank. */
  belowSRankMap: Record<string, string>;
  /** Sorted S-tier star segments, ascending by minStar. */
  starSegments: StarSegment[];
  /** Season correspondence is positional (current↔current, previous↔previous). */
  relativeSeasonAlignment: true;
}

/**
 * Pure 5E→Perfect equivalence. Returns null when the fact is not mappable
 * (unknown rank, or an S rank without an exact star count — a legacy gap).
 */
export function convertFiveeToPerfect(
  rank: string,
  stars: number | null,
  mapping: ConversionPolicyMapping,
): { rank: string; stars: number | null } | null {
  if (!isBuiltInStarRank("fivee", rank)) {
    if (Object.hasOwn(mapping.belowSRankMap, rank)) {
      const target = mapping.belowSRankMap[rank];
      return target ? { rank: target, stars: null } : null;
    }
    return null;
  }
  if (stars === null || stars === undefined) return null;
  if (!Number.isInteger(stars) || stars < 0) return null;
  const segment = mapping.starSegments.find((candidate) => stars >= candidate.minStar && (candidate.maxStar === null || stars <= candidate.maxStar));
  if (!segment) return null;
  if (segment.targetStarFloor === null) return { rank: segment.targetRank, stars: null };
  const perfectStars = segment.targetStarFloor + Math.ceil((stars - segment.minStar) * segment.slopeNum / segment.slopeDen);
  return { rank: segment.targetRank, stars: perfectStars };
}

/** The lead-approved first policy (`2026.09`). */
export const FIVE_TO_PERFECT_2026_09: ConversionPolicyMapping = {
  belowSRankMap: {
    D: "D",
    C: "C",
    "C+": "C+",
    "C++": "C++",
    B: "B",
    "B+": "B",
    "B++": "B+",
    A: "B++",
    "A+": "A",
    "A++": "A+",
  },
  starSegments: [
    { minStar: 0, maxStar: 5, targetRank: "A++", targetStarFloor: null, slopeNum: 0, slopeDen: 1 },
    { minStar: 6, maxStar: 12, targetRank: "青铜S", targetStarFloor: 0, slopeNum: 9, slopeDen: 6 },
    { minStar: 13, maxStar: 25, targetRank: "黄金S", targetStarFloor: 10, slopeNum: 14, slopeDen: 12 },
    { minStar: 26, maxStar: 45, targetRank: "钻石S", targetStarFloor: 25, slopeNum: 24, slopeDen: 19 },
    { minStar: 46, maxStar: null, targetRank: "魔王S", targetStarFloor: 50, slopeNum: 1, slopeDen: 1 },
  ],
  relativeSeasonAlignment: true,
};
