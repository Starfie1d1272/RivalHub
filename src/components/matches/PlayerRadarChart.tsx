"use client";

import type { HexagonScores } from "@/lib/utils/hexagon";

// ─── 轴配置（顺时针，从顶部开始） ─────────────────────────────────────────────

const AXES = [
  { key: "firepower",   label: "火力" },
  { key: "opening",     label: "破局" },
  { key: "multikill",   label: "多杀" },
  { key: "clutch",      label: "残局" },
  { key: "support",     label: "协同" },
  { key: "consistency", label: "稳定" },
] as const satisfies readonly { key: keyof HexagonScores; label: string }[];

// ─── 默认调色板 ────────────────────────────────────────────────────────────────

const DEFAULT_COLORS = [
  "var(--color-accent)",
  "var(--color-accent-b)",
  "#f59e0b",
  "#10b981",
  "#8b5cf6",
];

// ─── Props ─────────────────────────────────────────────────────────────────────

export interface RadarPlayer {
  name: string;
  scores: HexagonScores;
  color?: string;
  strokeColor?: string;
  strokeWidth?: number;
}

interface PlayerRadarChartProps {
  players: RadarPlayer[];
  size?: number;
}

// ─── 几何辅助函数 ──────────────────────────────────────────────────────────────

function angle(i: number): number {
  return (i / 6) * 2 * Math.PI - Math.PI / 2;
}

function vertex(cx: number, cy: number, r: number, i: number) {
  const a = angle(i);
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

function gridPolygon(cx: number, cy: number, r: number, scale: number): string {
  return Array.from({ length: 6 }, (_, i) => {
    const a = angle(i);
    return `${cx + r * scale * Math.cos(a)},${cy + r * scale * Math.sin(a)}`;
  }).join(" ");
}

function dataPolygon(cx: number, cy: number, r: number, scores: HexagonScores): string {
  return AXES.map((axis, i) => {
    const a = angle(i);
    const d = (scores[axis.key] / 100) * r;
    return `${cx + d * Math.cos(a)},${cy + d * Math.sin(a)}`;
  }).join(" ");
}

function labelPos(cx: number, cy: number, r: number, i: number) {
  const a = angle(i);
  const dist = r + 18;
  return { x: cx + dist * Math.cos(a), y: cy + dist * Math.sin(a) };
}

function scorePos(cx: number, cy: number, r: number, i: number, score: number) {
  const a = angle(i);
  const d = (score / 100) * r;
  // 偏移数值标注，使其靠近顶点外侧
  const offset = 10;
  const dist = d + offset;
  return { x: cx + dist * Math.cos(a), y: cy + dist * Math.sin(a) };
}

// ─── 组件 ──────────────────────────────────────────────────────────────────────

export function PlayerRadarChart({ players, size = 300 }: PlayerRadarChartProps) {
  if (players.length === 0) return null;

  const capped = players.slice(0, 6);
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.35;
  const isSingle = capped.length === 1;

  const gridLevels = [0.25, 0.5, 0.75, 1.0];

  return (
    <div className="flex flex-col items-center gap-3">
      {/* SVG 雷达图 */}
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[300px]">
        {/* 网格圈 */}
        {gridLevels.map((scale) => (
          <polygon
            key={scale}
            points={gridPolygon(cx, cy, r, scale)}
            fill="none"
            stroke="var(--color-border)"
            strokeWidth={1}
            strokeDasharray="4 3"
            opacity={0.5}
          />
        ))}

        {/* 轴线 */}
        {AXES.map((_, i) => {
          const v = vertex(cx, cy, r, i);
          return (
            <line
              key={i}
              x1={cx}
              y1={cy}
              x2={v.x}
              y2={v.y}
              stroke="var(--color-border)"
              strokeWidth={1}
              opacity={0.3}
            />
          );
        })}

        {/* 数据多边形（从后往前渲染，index 0 在最上层） */}
        {[...capped].reverse().map((player, revIdx) => {
          const idx = capped.length - 1 - revIdx;
          const color = player.color ?? DEFAULT_COLORS[idx] ?? DEFAULT_COLORS[0];
          const stroke = player.strokeColor ?? color;
          return (
            <polygon
              key={idx}
              points={dataPolygon(cx, cy, r, player.scores)}
              fill={color}
              fillOpacity={0.15}
              stroke={stroke}
              strokeWidth={player.strokeWidth ?? 1.5}
              strokeOpacity={0.8}
            />
          );
        })}

        {/* 轴标签 */}
        {AXES.map((axis, i) => {
          const pos = labelPos(cx, cy, r, i);
          return (
            <text
              key={axis.key}
              x={pos.x}
              y={pos.y}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={11}
              fill="var(--color-fg-mid)"
            >
              {axis.label}
            </text>
          );
        })}

        {/* 数值标注（仅单人模式） */}
        {isSingle &&
          AXES.map((axis, i) => {
            const score = Math.round(capped[0].scores[axis.key]);
            const pos = scorePos(cx, cy, r, i, capped[0].scores[axis.key]);
            return (
              <text
                key={`score-${axis.key}`}
                x={pos.x}
                y={pos.y}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={9}
                fill="var(--color-fg)"
              >
                {score}
              </text>
            );
          })}
      </svg>

      {/* 图例（HTML，在 SVG 外渲染） */}
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-[var(--color-fg-mid)]">
        {capped.map((player, idx) => {
          const color = player.color ?? DEFAULT_COLORS[idx] ?? DEFAULT_COLORS[0];
          const stroke = player.strokeColor ?? color;
          return (
            <span key={idx} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block w-2.5 h-2.5 shrink-0 border"
                style={{ background: color, borderColor: stroke, opacity: 0.8 }}
              />
              {player.name}
            </span>
          );
        })}
      </div>
    </div>
  );
}
