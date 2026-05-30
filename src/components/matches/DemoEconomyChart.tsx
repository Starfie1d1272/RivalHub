import React from "react";
import {
  buildEconomySeries,
  getEconomyBgColor,
  getEconomyLabel,
  ECONOMY_TYPES,
  type EconomyRow,
  type RoundEconomyType,
} from "@/lib/demo/economy-series";

interface DemoEconomyChartProps {
  economies: EconomyRow[];
  teamAName: string;
  teamBName: string;
  /** Round-level economy types for background band coloring */
  roundTypes?: RoundEconomyType[];
}

const W = 600;
const H = 220;
const PAD = { top: 24, right: 16, bottom: 28, left: 44 };
const CHART_W = W - PAD.left - PAD.right;
const CHART_H = H - PAD.top - PAD.bottom;

/** SVG line chart showing per-round equipment value with economy type background bands. */
export function DemoEconomyChart({
  economies,
  teamAName,
  teamBName,
  roundTypes,
}: DemoEconomyChartProps) {
  if (economies.length === 0) {
    return <p className="text-xs text-[var(--color-fg-dim)] py-2">No economy data</p>;
  }

  const series = buildEconomySeries(economies, roundTypes);

  if (series.length === 0) {
    return <p className="text-xs text-[var(--color-fg-dim)] py-2">No economy data</p>;
  }

  const maxVal = Math.max(...series.flatMap((s) => [s.teamA, s.teamB]), 1);
  const step = Math.max(5000, Math.ceil(maxVal / 4 / 5000) * 5000);
  const yMax = Math.ceil(maxVal / step) * step;

  const xScale = (i: number) =>
    PAD.left + (i / Math.max(series.length - 1, 1)) * CHART_W;
  const yScale = (v: number) =>
    PAD.top + CHART_H - (v / yMax) * CHART_H;

  const lineA = series
    .map(
      (s, i) =>
        `${i === 0 ? "M" : "L"}${xScale(i).toFixed(0)},${yScale(s.teamA).toFixed(0)}`,
    )
    .join(" ");
  const lineB = series
    .map(
      (s, i) =>
        `${i === 0 ? "M" : "L"}${xScale(i).toFixed(0)},${yScale(s.teamB).toFixed(0)}`,
    )
    .join(" ");

  const xTicks = series.filter(
    (_, i) => i % 3 === 0 || i === series.length - 1,
  );

  const yTicks: number[] = [];
  for (let v = 0; v <= yMax; v += step) yTicks.push(v);

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
      <svg width={W} height={H} className="text-[var(--color-fg)]">
        {/* 经济类型背景色块 */}
        {series.map((s, i) => {
          const x0 = xScale(i);
          const x1 =
            i < series.length - 1
              ? xScale(i + 1)
              : xScale(i) + xScale(1) - xScale(0);
          const w = Math.max(x1 - x0, 2);
          // Team A half (top) and Team B half (bottom)
          return (
            <g key={`bg-${i}`}>
              <rect
                x={x0}
                y={PAD.top}
                width={w}
                height={CHART_H / 2}
                fill={getEconomyBgColor(s.teamAEconomy)}
              />
              <rect
                x={x0}
                y={PAD.top + CHART_H / 2}
                width={w}
                height={CHART_H / 2}
                fill={getEconomyBgColor(s.teamBEconomy)}
              />
            </g>
          );
        })}

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
        <path
          d={lineA}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth={2}
        />
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
        <path
          d={lineB}
          fill="none"
          stroke="var(--color-accent-b)"
          strokeWidth={2}
        />
        {series.map((s, i) => (
          <circle
            key={`b-${i}`}
            cx={xScale(i)}
            cy={yScale(s.teamB)}
            r={2.5}
            fill="var(--color-accent-b)"
          />
        ))}
      </svg>
      </div>

      {/* HTML 图例 */}
      <div className="flex flex-col gap-2 text-xs">
        {/* 折线图例 */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-4 h-0.5 rounded" style={{ background: "var(--color-accent)" }} />
            <span className="text-[var(--color-fg)]">{teamAName}</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-4 h-0.5 rounded" style={{ background: "var(--color-accent-b)" }} />
            <span className="text-[var(--color-fg)]">{teamBName}</span>
          </span>
          <span className="text-[var(--color-fg-dim)]">折线为每回合装备价值</span>
        </div>

        {/* 经济类型背景图例 */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-[var(--color-fg-dim)]">回合经济（上半区 {teamAName} / 下半区 {teamBName}）：</span>
          {ECONOMY_TYPES.map((t) => (
            <span key={t} className="inline-flex items-center gap-1">
              <span
                className="inline-block w-3 h-3 rounded-sm border border-[var(--color-border)]"
                style={{ background: getEconomyBgColor(t) }}
              />
              <span className="text-[var(--color-fg-mid)]">{getEconomyLabel(t)}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
