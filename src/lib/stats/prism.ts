/**
 * PRISM 八维 + 六维雷达图共享类型与工具函数。
 *
 * 从 RadarChart.tsx 提取到纯工具模块，避免 Server Component import "use client" 导出。
 * RadarChart.tsx 和 Server Component 均从此文件导入。
 */

// ─── 轴配置类型 ────────────────────────────────────────────────────────────────

export interface RadarAxis {
  key: string;
  label: string;
}

// ─── PRISM 八维 ────────────────────────────────────────────────────────────────

export const PRISM_AXES: readonly RadarAxis[] = [
  { key: "firepower", label: "Firepower" },
  { key: "opening",   label: "Opening" },
  { key: "entry",     label: "Entry" },
  { key: "trading",   label: "Trading" },
  { key: "clutch",    label: "Clutch" },
  { key: "sniping",   label: "Sniping" },
  { key: "utility",   label: "Utility" },
  { key: "survival",  label: "Survival" },
] as const;

export interface PrismScores {
  firepower: number;
  opening: number;
  clutch: number;
  sniping: number;
  survival: number;
  utility: number;
  trading: number;
  entry: number;
}

/** 从 player_ratings 查询行构建 PrismScores（raw values → Number） */
export function buildPrismScores(r: Record<string, unknown>): PrismScores | null {
  if (r.prismFirepower == null) return null;
  return {
    firepower: Number(r.prismFirepower ?? r.firepower),
    opening:   Number(r.prismOpening   ?? r.opening),
    clutch:    Number(r.prismClutch    ?? r.clutch),
    sniping:   Number(r.prismSniping   ?? r.sniping),
    survival:  Number(r.prismSurvival  ?? r.survival),
    utility:   Number(r.prismUtility   ?? r.utility),
    trading:   Number(r.prismTrading   ?? r.trading),
    entry:     Number(r.prismEntry     ?? r.entry),
  };
}

/** 对 PrismScores 列表按轴求均值（返回 null 列表为空时） */
export function averagePrismScores(prisms: PrismScores[]): PrismScores | null {
  if (prisms.length === 0) return null;
  return Object.fromEntries(
    PRISM_AXES.map((a) => [a.key, prisms.reduce((s, p) => s + (p[a.key as keyof PrismScores] ?? 0), 0) / prisms.length]),
  ) as unknown as PrismScores;
}

// ─── 六维（HexagonScores 兼容） ────────────────────────────────────────────────

export const HEX_AXES: readonly RadarAxis[] = [
  { key: "firepower", label: "Firepower" },
  { key: "opening",   label: "Opening" },
  { key: "multikill", label: "MultiKill" },
  { key: "clutch",    label: "Clutch" },
  { key: "utility",   label: "Utility" },
  { key: "survival",  label: "Survival" },
] as const;
