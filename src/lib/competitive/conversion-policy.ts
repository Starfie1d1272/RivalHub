import {
  BUILT_IN_COMPETITIVE_PLATFORMS,
  isBuiltInStarRank,
} from "@/lib/competitive/builtins";

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

function assertInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value)) throw new Error(`${label} 必须是整数。`);
}

/**
 * Validate the complete 5E → Perfect mapping shape before it is persisted or
 * approved. This stays pure so the same rule can be used by commands and
 * focused unit tests without making the rank catalog a client-owned copy.
 */
export function validateConversionPolicyMapping(mapping: ConversionPolicyMapping): void {
  if (!mapping || mapping.relativeSeasonAlignment !== true) {
    throw new Error("换算策略必须启用相对赛季对齐。 ");
  }

  const sourceBelowSRanks = BUILT_IN_COMPETITIVE_PLATFORMS.fivee.ranks.filter((rank) => rank.starMin === null);
  const targetRanks = new Map(BUILT_IN_COMPETITIVE_PLATFORMS.perfect_world.ranks.map((rank) => [rank.rankKey, rank]));
  const targetBelowSRanks = new Set(BUILT_IN_COMPETITIVE_PLATFORMS.perfect_world.ranks.filter((rank) => rank.starMin === null).map((rank) => rank.rankKey));
  const belowSRankMap = mapping.belowSRankMap;
  if (!belowSRankMap || typeof belowSRankMap !== "object" || Array.isArray(belowSRankMap)) {
    throw new Error("换算策略缺少非 S 段位映射。 ");
  }
  const sourceRankKeys = new Set(sourceBelowSRanks.map((rank) => rank.rankKey));
  const mappedKeys = Object.keys(belowSRankMap);
  const missingSourceRank = sourceBelowSRanks.find((rank) => typeof belowSRankMap[rank.rankKey] !== "string" || !belowSRankMap[rank.rankKey]?.trim());
  if (missingSourceRank) throw new Error(`缺少 5E 段位 ${missingSourceRank.rankKey} 的换算目标。`);
  const extraSourceRank = mappedKeys.find((rank) => !sourceRankKeys.has(rank));
  if (extraSourceRank) throw new Error(`非 S 映射包含无效的 5E 段位 ${extraSourceRank}。`);
  for (const sourceRank of sourceBelowSRanks) {
    const targetRank = belowSRankMap[sourceRank.rankKey];
    if (!targetBelowSRanks.has(targetRank)) {
      throw new Error(`5E 段位 ${sourceRank.rankKey} 的目标段位 ${targetRank} 无效。`);
    }
  }

  if (!Array.isArray(mapping.starSegments) || mapping.starSegments.length === 0) {
    throw new Error("S 段星数映射不能为空。 ");
  }
  let expectedMinStar = 0;
  for (const [index, segment] of mapping.starSegments.entries()) {
    assertInteger(segment.minStar, `第 ${index + 1} 段的起始星数`);
    if (segment.minStar !== expectedMinStar || segment.minStar < 0) {
      throw new Error("S 段星数映射必须从 0 开始连续排列，不能有 gap 或 overlap。 ");
    }
    const isLast = index === mapping.starSegments.length - 1;
    if (isLast && segment.maxStar !== null) throw new Error("最后一段 S 段星数映射必须使用开放上限。 ");
    if (!isLast && segment.maxStar === null) throw new Error("只有最后一段 S 段星数映射可以没有上限。 ");
    if (segment.maxStar !== null) {
      assertInteger(segment.maxStar, `第 ${index + 1} 段的结束星数`);
      if (segment.maxStar < segment.minStar) throw new Error("S 段星数映射的结束星数不能小于起始星数。 ");
      expectedMinStar = segment.maxStar + 1;
    }
    assertInteger(segment.slopeNum, `第 ${index + 1} 段的斜率分子`);
    assertInteger(segment.slopeDen, `第 ${index + 1} 段的斜率分母`);
    if (segment.slopeNum < 0 || segment.slopeDen <= 0) throw new Error("S 段星数映射的斜率必须为非负数，分母必须大于 0。 ");

    const target = targetRanks.get(segment.targetRank);
    if (!target) throw new Error(`第 ${index + 1} 段的目标段位 ${segment.targetRank} 无效。`);
    if (target.starMin === null) {
      if (segment.targetStarFloor !== null) throw new Error(`无星目标段位 ${segment.targetRank} 不能设置 targetStarFloor。`);
      continue;
    }
    const targetStarFloor = segment.targetStarFloor;
    assertInteger(targetStarFloor, `第 ${index + 1} 段的目标起始星数`);
    if (targetStarFloor < target.starMin || (target.starMax !== null && targetStarFloor > target.starMax)) {
      throw new Error(`第 ${index + 1} 段的 targetStarFloor 不符合目标段位 ${segment.targetRank} 的星数范围。`);
    }
    if (segment.maxStar !== null && target.starMax !== null) {
      const convertedMax = targetStarFloor + Math.ceil((segment.maxStar - segment.minStar) * segment.slopeNum / segment.slopeDen);
      if (convertedMax > target.starMax) throw new Error(`第 ${index + 1} 段的换算结果超出目标段位 ${segment.targetRank} 的星数范围。`);
    }
  }
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
