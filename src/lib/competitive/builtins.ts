import { PERFECT_WORLD_RANK_ORDER } from "../config/perfect-world";

/**
 * 2.0 ships exactly these competitive-profile domains. This module is the
 * code-owned product definition the migration bootstraps from and the
 * migration replay derives its expected database state from; the database
 * catalog remains the runtime owner. New platform identities, new ranks or a
 * changed canonical Rating all require an explicit product/migration change
 * instead of operator-created ad-hoc domains.
 */

export type BuiltInRankDefinition = {
  /** Stable rank identity on the platform ladder. */
  rankKey: string;
  /** Initial display label; operators may rename labels later. */
  label: string;
  /** Lowest → highest position on the ladder. */
  sortOrder: number;
  /** Inclusive star lower bound; null/null means this rank has no stars. */
  starMin: number | null;
  /** Inclusive star upper bound; null with starMin means open-ended. */
  starMax: number | null;
};

export type BuiltInPlatformDefinition = {
  key: string;
  displayName: string;
  /** Product-fixed canonical performance Rating (never a matchmaking score). */
  ratingLabel: string;
  ranks: BuiltInRankDefinition[];
};

/** Explicit in-rank star ranges; every rank without an entry is starless. */
const STAR_RANGES_BY_RANK = {
  // Perfect World S tiers.
  "青铜S": [0, 9],
  "黄金S": [10, 24],
  "钻石S": [25, 49],
  "魔王S": [50, null],
  // 5E S tiers.
  S: [0, 19],
  SS: [20, 39],
  SSS: [40, null],
} satisfies Record<string, [number, number | null]>;

/** Shared below-S foundation both built-in ladders are built on (D → A++). */
const BELOW_S_ORDER = PERFECT_WORLD_RANK_ORDER.slice(0, PERFECT_WORLD_RANK_ORDER.indexOf("青铜S"));

function rankDefinitions(order: readonly string[]): BuiltInRankDefinition[] {
  return order.map((rankKey, sortOrder) => {
    const range = STAR_RANGES_BY_RANK[rankKey as keyof typeof STAR_RANGES_BY_RANK];
    return { rankKey, label: rankKey, sortOrder, starMin: range?.[0] ?? null, starMax: range?.[1] ?? null };
  });
}

export const BUILT_IN_COMPETITIVE_PLATFORMS: {
  perfect_world: BuiltInPlatformDefinition;
  fivee: BuiltInPlatformDefinition;
} = {
  perfect_world: {
    key: "perfect_world",
    displayName: "完美世界竞技平台",
    ratingLabel: "Rating Pro",
    ranks: rankDefinitions(PERFECT_WORLD_RANK_ORDER),
  },
  fivee: {
    key: "fivee",
    displayName: "5E",
    ratingLabel: "Rating+",
    ranks: rankDefinitions([...BELOW_S_ORDER, "S", "SS", "SSS"]),
  },
};

export type BuiltInCompetitivePlatformKey = keyof typeof BUILT_IN_COMPETITIVE_PLATFORMS;

export const BUILT_IN_COMPETITIVE_PLATFORM_KEYS = Object.keys(BUILT_IN_COMPETITIVE_PLATFORMS) as BuiltInCompetitivePlatformKey[];

/**
 * Product-owned presentation and evidence priority. Never derive this from a
 * database key: Perfect World is the Major's primary platform, while 5E is
 * supporting long-lived evidence.
 */
const COMPETITIVE_PLATFORM_PRIORITY = ["perfect_world", "fivee"] as const;

export function compareCompetitivePlatformPriority(left: string, right: string): number {
  const leftIndex = COMPETITIVE_PLATFORM_PRIORITY.indexOf(left as typeof COMPETITIVE_PLATFORM_PRIORITY[number]);
  const rightIndex = COMPETITIVE_PLATFORM_PRIORITY.indexOf(right as typeof COMPETITIVE_PLATFORM_PRIORITY[number]);
  const normalizedLeft = leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex;
  const normalizedRight = rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex;
  return normalizedLeft - normalizedRight || left.localeCompare(right);
}

export function isBuiltInCompetitivePlatformKey(value: string): value is BuiltInCompetitivePlatformKey {
  // hasOwnProperty instead of `in`: the `in` operator walks the prototype
  // chain, so "toString" / "constructor" / "__proto__" would pass.
  return Object.prototype.hasOwnProperty.call(BUILT_IN_COMPETITIVE_PLATFORMS, value);
}
