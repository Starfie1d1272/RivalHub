/** 完美世界竞技平台公布的段位顺序（低 → 高）。 */
export const PERFECT_WORLD_RANK_ORDER = [
  "D",
  "C",
  "C+",
  "C++",
  "B",
  "B+",
  "B++",
  "A",
  "A+",
  "A++",
  "青铜S",
  "黄金S",
  "钻石S",
  "魔王S",
] as const;

/**
 * 完美世界 S 段位（青铜/黄金/钻石/魔王）按总星数分档。外校实力相对限制
 * 复用同一组段位与总星数语义，不另造一套“S + 局部星数”的表示。
 */
export function createPerfectWorldRankOrder(): string[] {
  return [...PERFECT_WORLD_RANK_ORDER];
}
