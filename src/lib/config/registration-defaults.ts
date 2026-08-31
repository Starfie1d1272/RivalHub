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
import { CS2_POSITION_LABELS, CS2_POSITION_VALUES } from "@/lib/config/cs2-positions";

const PERFECT_WORLD_RANK_LABELS = Object.fromEntries(
  PERFECT_WORLD_RANK_ORDER.map((rank) => [rank, rank]),
) as Record<(typeof PERFECT_WORLD_RANK_ORDER)[number], string>;

export const REGISTRATION_DEFAULTS = {
  positions: {
    values: CS2_POSITION_VALUES,
    labels: CS2_POSITION_LABELS,
  },

  ranks: {
    values: PERFECT_WORLD_RANK_ORDER,
    labels: PERFECT_WORLD_RANK_LABELS,
  },

} as const;

export type PositionValue =
  (typeof REGISTRATION_DEFAULTS.positions.values)[number];
export type RankValue = (typeof REGISTRATION_DEFAULTS.ranks.values)[number];
