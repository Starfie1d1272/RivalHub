"use client";

import { useState } from "react";
import { mapLabel } from "@/lib/maps";

interface MapData {
  winRate: number;
  pickRate: number;
  banRate: number;
}

interface MapPoolRadarChartProps {
  mapPool: string[];
  teamAName: string;
  teamBName: string;
  teamAData: Map<string, MapData>;
  teamBData: Map<string, MapData>;
}

// Team A / Team B colors via CSS design tokens（SVG inline style 支持 CSS var）

const METRICS = [
  { key: "win" as const, label: "Win%" },
  { key: "pick" as const, label: "Pick%" },
  { key: "ban" as const, label: "Ban%" },
];

function getMetricValue(data: MapData | undefined, metric: "win" | "pick" | "ban"): number {
  if (!data) return 0;
  if (metric === "win") return data.winRate;
  if (metric === "pick") return data.pickRate;
  return data.banRate;
}

export function MapPoolRadarChart({
  mapPool,
  teamAName,
  teamBName,
  teamAData,
  teamBData,
}: MapPoolRadarChartProps) {
  const [metric, setMetric] = useState<"win" | "pick" | "ban">("win");

  const n = mapPool.length;
  const cx = 200;
  const cy = 200;
  const r = 140;

  const angle = (i: number) => ((i / n) * 2 * Math.PI) - Math.PI / 2;
  const vertex = (i: number) => ({
    x: cx + r * Math.cos(angle(i)),
    y: cy + r * Math.sin(angle(i)),
  });
  const dataPoint = (i: number, value: number) => {
    const a = angle(i);
    const d = (value / 100) * r;
    return { x: cx + d * Math.cos(a), y: cy + d * Math.sin(a) };
  };

  const gridLevels = [0.25, 0.5, 0.75, 1.0];

  const gridPolygon = (scale: number) => {
    const points = Array.from({ length: n }, (_, i) => {
      const a = angle(i);
      return `${cx + r * scale * Math.cos(a)},${cy + r * scale * Math.sin(a)}`;
    });
    return points.join(" ");
  };

  const dataPolygon = (teamData: Map<string, MapData>) => {
    const points = mapPool.map((map, i) => {
      const val = getMetricValue(teamData.get(map), metric);
      const pt = dataPoint(i, val);
      return `${pt.x},${pt.y}`;
    });
    return points.join(" ");
  };

  const labelPos = (i: number) => {
    const a = angle(i);
    const dist = r + 22;
    return {
      x: cx + dist * Math.cos(a),
      y: cy + dist * Math.sin(a),
    };
  };

  if (n === 0) return null;

  return (
    <div className="flex flex-col items-center gap-3">
      {/* Metric toggle */}
      <div className="flex gap-1">
        {METRICS.map((m) => (
          <button
            key={m.key}
            onClick={() => setMetric(m.key)}
            className="px-3 py-1 text-xs rounded transition-colors"
            style={{
              background:
                metric === m.key
                  ? "var(--color-accent)"
                  : "var(--color-panel-hi)",
              color:
                metric === m.key
                  ? "#fff"
                  : "var(--color-fg-mid)",
              border: "1px solid var(--color-border)",
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* SVG radar */}
      <svg viewBox="0 0 400 380" className="w-full max-w-[400px]">
        {/* Grid rings */}
        {gridLevels.map((scale) => (
          <polygon
            key={scale}
            points={gridPolygon(scale)}
            fill="none"
            stroke="var(--color-border)"
            strokeWidth={1}
            strokeDasharray="4 3"
            opacity={0.6}
          />
        ))}

        {/* Axis lines */}
        {Array.from({ length: n }, (_, i) => {
          const v = vertex(i);
          return (
            <line
              key={i}
              x1={cx}
              y1={cy}
              x2={v.x}
              y2={v.y}
              stroke="var(--color-border)"
              strokeWidth={1}
              opacity={0.4}
            />
          );
        })}

        {/* Team B polygon */}
        <polygon
          points={dataPolygon(teamBData)}
          style={{ fill: "var(--color-accent-b-soft)", stroke: "var(--color-accent-b)" }}
          strokeWidth={1.5}
        />

        {/* Team A polygon */}
        <polygon
          points={dataPolygon(teamAData)}
          style={{ fill: "var(--color-accent-soft)", stroke: "var(--color-accent)" }}
          strokeWidth={1.5}
        />

        {/* Map labels */}
        {mapPool.map((map, i) => {
          const pos = labelPos(i);
          return (
            <text
              key={map}
              x={pos.x}
              y={pos.y}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={10}
              fill="var(--color-fg-mid)"
            >
              {mapLabel(map)}
            </text>
          );
        })}

      </svg>

      {/* Legend — 卡片底部，不受 SVG viewBox 约束 */}
      <div className="flex items-center gap-4 text-xs text-[var(--color-fg-mid)]">
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block w-2.5 h-2.5 shrink-0 border"
            style={{ background: "var(--color-accent-soft)", borderColor: "var(--color-accent)" }}
          />
          {teamAName}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block w-2.5 h-2.5 shrink-0 border"
            style={{ background: "var(--color-accent-b-soft)", borderColor: "var(--color-accent-b)" }}
          />
          {teamBName}
        </span>
      </div>
      </div>
  );
}
