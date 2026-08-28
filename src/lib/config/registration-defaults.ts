/**
 * 报名系统默认配置
 *
 * 赛季级业务上限已迁移到 seasons.registration_config JSONB 列，
 * 此文件保留位置与段位等 fallback 默认值。
 *
 * 当前为 CS2 完美平台选秀联赛的默认设置：
 * - 5 个标准 CS2 位置
 * - 完美平台当前段位体系（D~魔王S）
 * - 每位置 15 人上限（8 队 × 7 人 = 56，5 位置各约 11，预留 buffer）
 */

import { PERFECT_WORLD_RANK_ORDER } from "@/lib/config/perfect-world";

const PERFECT_WORLD_RANK_LABELS = Object.fromEntries(
  PERFECT_WORLD_RANK_ORDER.map((rank) => [rank, rank]),
) as Record<(typeof PERFECT_WORLD_RANK_ORDER)[number], string>;

export const REGISTRATION_DEFAULTS = {
  positions: {
    values: [
      "igl",
      "awper",
      "opener",
      "closer",
      "anchor",
    ] as const,
    labels: {
      igl: { cn: "指挥", en: "IGL", full: "IGL（指挥）" },
      awper: { cn: "狙击手", en: "AWPer", full: "AWPer（狙击手）" },
      opener: { cn: "突破手", en: "Opener", full: "Opener（突破手）" },
      closer: { cn: "自由人/残局", en: "Closer", full: "Closer（自由人/残局）" },
      anchor: { cn: "主防", en: "Anchor", full: "Anchor（主防）" },
    } as const,
  },

  ranks: {
    values: PERFECT_WORLD_RANK_ORDER,
    labels: PERFECT_WORLD_RANK_LABELS,
  },

} as const;

export type PositionValue =
  (typeof REGISTRATION_DEFAULTS.positions.values)[number];
export type RankValue = (typeof REGISTRATION_DEFAULTS.ranks.values)[number];
