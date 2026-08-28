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

export function createPerfectWorldRankOrder(): string[] {
  return [...PERFECT_WORLD_RANK_ORDER];
}
