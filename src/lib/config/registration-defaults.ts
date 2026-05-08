/**
 * 报名系统默认配置
 *
 * TODO (Phase 7-8): 将这些配置迁移到 seasons.registration_config JSONB 列，
 * 实现赛事级可配置。迁移后，此文件作为 fallback 默认值保留。
 *
 * 当前为 CS2 完美平台选秀联赛的默认设置：
 * - 5 个标准 CS2 位置
 * - 完美平台当前段位体系（D~魔王S）
 * - 每位置 15 人上限（8 队 × 7 人 = 56，5 位置各约 11，预留 buffer）
 * - 5 张天梯截图
 */

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
    values: [
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
    ] as const,
    labels: {
      D: "D",
      C: "C",
      "C+": "C+",
      "C++": "C++",
      B: "B",
      "B+": "B+",
      "B++": "B++",
      A: "A",
      "A+": "A+",
      "A++": "A++",
      "青铜S": "青铜S",
      "黄金S": "黄金S",
      "钻石S": "钻石S",
      "魔王S": "魔王S",
    } as const,
  },

  /** 每个主选位置报名人数上限 */
  maxPerPosition: 15,

  /** 天梯截图：单个 NJUBox 分享链接 */
  screenshotCount: 1,
} as const;

export type PositionValue =
  (typeof REGISTRATION_DEFAULTS.positions.values)[number];
export type RankValue = (typeof REGISTRATION_DEFAULTS.ranks.values)[number];
