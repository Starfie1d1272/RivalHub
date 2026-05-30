"use client";

/**
 * 通用 N 轴雷达图。
 *
 * PlayerRadarChart 是写死六维（HexagonScores）的特化版本；本组件接受任意轴配置，
 * 供 PRISM 八维等场景复用。scores 用 Record<string, number>（0–100）。
 */

const DEFAULT_COLORS = [
  "var(--color-accent)",
  "var(--color-accent-b)",
  "#f59e0b",
  "#10b981",
  "#8b5cf6",
];

export interface RadarAxis {
  key: string;
  label: string;
}

export interface RadarSeries {
  name: string;
  scores: Record<string, number>;
  color?: string;
  strokeColor?: string;
  strokeWidth?: number;
}

interface RadarChartProps {
  axes: readonly RadarAxis[];
  series: RadarSeries[];
  size?: number;
}

export function RadarChart({ axes, series, size = 300 }: RadarChartProps) {
  if (series.length === 0 || axes.length === 0) return null;

  const n = axes.length;
  const capped = series.slice(0, 6);
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.35;
  const isSingle = capped.length === 1;
  const gridLevels = [0.25, 0.5, 0.75, 1.0];

  const angle = (i: number) => (i / n) * 2 * Math.PI - Math.PI / 2;
  const gridPolygon = (scale: number) =>
    axes
      .map((_, i) => {
        const a = angle(i);
        return `${cx + r * scale * Math.cos(a)},${cy + r * scale * Math.sin(a)}`;
      })
      .join(" ");
  const dataPolygon = (scores: Record<string, number>) =>
    axes
      .map((axis, i) => {
        const a = angle(i);
        const d = ((scores[axis.key] ?? 0) / 100) * r;
        return `${cx + d * Math.cos(a)},${cy + d * Math.sin(a)}`;
      })
      .join(" ");

  const resolved = capped.map((s, idx) => {
    const color = s.color ?? DEFAULT_COLORS[idx] ?? DEFAULT_COLORS[0];
    return { ...s, color, stroke: s.strokeColor ?? color };
  });

  return (
    <div className="flex flex-col items-center gap-3">
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[300px]">
        {gridLevels.map((scale) => (
          <polygon
            key={scale}
            points={gridPolygon(scale)}
            fill="none"
            stroke="var(--color-border)"
            strokeWidth={1}
            strokeDasharray="4 3"
            opacity={0.5}
          />
        ))}

        {axes.map((_, i) => {
          const a = angle(i);
          return (
            <line
              key={i}
              x1={cx}
              y1={cy}
              x2={cx + r * Math.cos(a)}
              y2={cy + r * Math.sin(a)}
              stroke="var(--color-border)"
              strokeWidth={1}
              opacity={0.3}
            />
          );
        })}

        {[...resolved].reverse().map((s, revIdx) => (
          <polygon
            key={revIdx}
            points={dataPolygon(s.scores)}
            fill={s.color}
            fillOpacity={0.15}
            stroke={s.stroke}
            strokeWidth={s.strokeWidth ?? 1.5}
            strokeOpacity={0.8}
          />
        ))}

        {axes.map((axis, i) => {
          const a = angle(i);
          const dist = r + 18;
          return (
            <text
              key={axis.key}
              x={cx + dist * Math.cos(a)}
              y={cy + dist * Math.sin(a)}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={11}
              fill="var(--color-fg-mid)"
            >
              {axis.label}
            </text>
          );
        })}

        {isSingle &&
          axes.map((axis, i) => {
            const raw = resolved[0].scores[axis.key] ?? 0;
            const a = angle(i);
            const dist = (raw / 100) * r + 10;
            return (
              <text
                key={`score-${axis.key}`}
                x={cx + dist * Math.cos(a)}
                y={cy + dist * Math.sin(a)}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={9}
                fill="var(--color-fg)"
              >
                {Math.round(raw)}
              </text>
            );
          })}
      </svg>

      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-[var(--color-fg-mid)]">
        {resolved.map((s, idx) => (
          <span key={idx} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block w-2.5 h-2.5 shrink-0 border"
              style={{ background: s.color, borderColor: s.stroke, opacity: 0.8 }}
            />
            {s.name}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── PRISM 八维轴配置 ──────────────────────────────────────────────────────────
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

// ─── 六维轴配置（与 PlayerRadarChart 口径一致） ────────────────────────────────
export const HEX_AXES: readonly RadarAxis[] = [
  { key: "firepower", label: "Firepower" },
  { key: "opening",   label: "Opening" },
  { key: "multikill", label: "MultiKill" },
  { key: "clutch",    label: "Clutch" },
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

// ─── 共享工具函数 ──────────────────────────────────────────────────────────

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
