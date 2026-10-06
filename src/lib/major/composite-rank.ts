import { PERFECT_WORLD_RANK_ORDER } from "@/lib/config/perfect-world";

export type CompositeRank = { rank: string; stars: number | null };

/** Canonical Perfect axis, after source conversion/selection. No Rating input. */
export function compositeStrength(fact: { rank: string; stars?: number | null }): number | null {
  const index = (PERFECT_WORLD_RANK_ORDER as readonly string[]).indexOf(fact.rank);
  if (index < 0) return null;
  if (index < 10) return index;
  if (fact.stars === null || fact.stars === undefined || !Number.isInteger(fact.stars) || fact.stars < 0) return null;
  return 12 + fact.stars / 3;
}

/** Nearest official point; exact midpoint ties always choose the stronger point. */
export function compositeDisplayRank(value: number | null): CompositeRank | null {
  if (value === null || !Number.isFinite(value)) return null;
  if (value < 10.5) return { rank: PERFECT_WORLD_RANK_ORDER[Math.max(0, Math.min(9, Math.floor(value + 0.5)))]!, stars: null };
  const stars = Math.max(0, Math.floor((value - 12) * 3 + 0.5 + 1e-9));
  return { rank: stars >= 50 ? "魔王S" : stars >= 25 ? "钻石S" : stars >= 10 ? "黄金S" : "青铜S", stars };
}
