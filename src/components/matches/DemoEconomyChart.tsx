import React from "react";
import { buildEconomySeries, type EconomyRow } from "@/lib/demo/economy-series";

interface DemoEconomyChartProps {
  economies: EconomyRow[];
}

const W = 600;
const H = 200;
const PAD = { top: 20, right: 16, bottom: 28, left: 44 };
const CHART_W = W - PAD.left - PAD.right;
const CHART_H = H - PAD.top - PAD.bottom;

/** 简易 SVG 折线图展示两队每回合装备价值 */
export function DemoEconomyChart({ economies }: DemoEconomyChartProps) {
  if (economies.length === 0) {
    return <p className="text-xs text-[var(--color-fg-dim)] py-2">暂无经济数据</p>;
  }

  const series = buildEconomySeries(economies);

  if (series.length === 0) {
    return <p className="text-xs text-[var(--color-fg-dim)] py-2">暂无经济数据</p>;
  }

  const maxVal = Math.max(...series.flatMap((s) => [s.teamA, s.teamB]), 1);
  // 纵轴步进（按 5000 取整）
  const step = Math.max(5000, Math.ceil(maxVal / 4 / 5000) * 5000);
  const yMax = Math.ceil(maxVal / step) * step;

  const xScale = (i: number) => PAD.left + (i / Math.max(series.length - 1, 1)) * CHART_W;
  const yScale = (v: number) => PAD.top + CHART_H - (v / yMax) * CHART_H;

  // 折线 path
  const lineA = series
    .map((s, i) => `${i === 0 ? "M" : "L"}${xScale(i).toFixed(0)},${yScale(s.teamA).toFixed(0)}`)
    .join(" ");
  const lineB = series
    .map((s, i) => `${i === 0 ? "M" : "L"}${xScale(i).toFixed(0)},${yScale(s.teamB).toFixed(0)}`)
    .join(" ");

  // X 轴刻度（每 3 回合标一个）
  const xTicks = series.filter((_, i) => i % 3 === 0 || i === series.length - 1);

  // Y 轴刻度
  const yTicks: number[] = [];
  for (let v = 0; v <= yMax; v += step) yTicks.push(v);

  return (
    <div className="overflow-x-auto">
      <svg width={W} height={H} className="text-[var(--color-fg)]">
        {/* 网格线 */}
        {yTicks.map((v) => (
          <g key={v}>
            <line
              x1={PAD.left}
              y1={yScale(v)}
              x2={W - PAD.right}
              y2={yScale(v)}
              stroke="var(--color-border)"
              strokeWidth={0.5}
            />
            <text
              x={PAD.left - 4}
              y={yScale(v) + 3}
              textAnchor="end"
              className="text-[10px] fill-[var(--color-fg-dim)]"
            >
              {v.toLocaleString()}
            </text>
          </g>
        ))}

        {/* X 轴标签 */}
        {xTicks.map((s) => {
          const x = xScale(series.indexOf(s));
          return (
            <text
              key={s.roundNumber}
              x={x}
              y={H - 6}
              textAnchor="middle"
              className="text-[9px] fill-[var(--color-fg-dim)]"
            >
              R{s.roundNumber}
            </text>
          );
        })}

        {/* TeamA 折线 */}
        <path d={lineA} fill="none" stroke="var(--color-accent)" strokeWidth={2} />
        {series.map((s, i) => (
          <circle
            key={`a-${i}`}
            cx={xScale(i)}
            cy={yScale(s.teamA)}
            r={2.5}
            fill="var(--color-accent)"
          />
        ))}

        {/* TeamB 折线 */}
        <path d={lineB} fill="none" stroke="var(--color-accent-b)" strokeWidth={2} />
        {series.map((s, i) => (
          <circle
            key={`b-${i}`}
            cx={xScale(i)}
            cy={yScale(s.teamB)}
            r={2.5}
            fill="var(--color-accent-b)"
          />
        ))}

        {/* 图例 */}
        <g transform={`translate(${W - 120}, 8)`}>
          <line x1={0} y1={0} x2={16} y2={0} stroke="var(--color-accent)" strokeWidth={2} />
          <text x={20} y={3} className="text-[10px] fill-[var(--color-fg)]">
            Team A
          </text>
          <line x1={0} y1={14} x2={16} y2={14} stroke="var(--color-accent-b)" strokeWidth={2} />
          <text x={20} y={17} className="text-[10px] fill-[var(--color-fg)]">
            Team B
          </text>
        </g>
      </svg>
    </div>
  );
}
