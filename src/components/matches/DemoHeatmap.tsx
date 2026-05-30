"use client";

import React, { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils/cn";
import { getCalibration, worldToPixel } from "@/lib/demo/map-calibration";
import type { DemoPoint } from "@/actions/demo-detail";

type HeatmapMode = "kills" | "deaths" | "bombs" | "grenades";

const MODE_CONFIG: Record<HeatmapMode, { label: string; color: string; lightColor: string }> = {
  kills: { label: "Kills", color: "color-mix(in srgb, var(--color-danger) 35%, transparent)", lightColor: "color-mix(in srgb, var(--color-danger) 12%, transparent)" },
  deaths: { label: "Deaths", color: "color-mix(in srgb, var(--color-warn) 30%, transparent)", lightColor: "color-mix(in srgb, var(--color-warn) 10%, transparent)" },
  bombs: { label: "Bombs", color: "color-mix(in srgb, var(--color-accent-b) 35%, transparent)", lightColor: "color-mix(in srgb, var(--color-accent-b) 12%, transparent)" },
  grenades: { label: "Grenades", color: "color-mix(in srgb, var(--color-accent-b) 30%, transparent)", lightColor: "color-mix(in srgb, var(--color-accent-b) 10%, transparent)" },
};

/**
 * 坐标 (0,0) 视为无效——demo 导出端缺失击杀坐标时会把所有点写成世界原点，
 * 若不过滤会让全部点堆叠成一个红圈，反而误导。
 */
function isRealPoint(p: { x: number; y: number }): boolean {
  return p.x !== 0 || p.y !== 0;
}

interface DemoHeatmapProps {
  mapName: string;
  points: {
    kills: DemoPoint[];
    deaths: DemoPoint[];
    bombs: DemoPoint[];
    grenades: DemoPoint[];
  };
}

/**
 * Static heatmap component.
 * Renders semi-transparent radial gradient dots on top of a radar base image.
 * Mode toggle: Kills / Deaths / Bombs / Grenades.
 */
export function DemoHeatmap({ mapName, points }: DemoHeatmapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<HeatmapMode>("kills");

  const cal = getCalibration(mapName);

  // 始终使用 1024×1024 逻辑尺寸绘制，CSS w-full 负责缩放显示
  const CANVAS_SIZE = 1024;

  const drawHeatmap = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = CANVAS_SIZE;
    canvas.height = CANVAS_SIZE;
    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    if (!cal) return;

    const config = MODE_CONFIG[mode];
    const pts = points[mode].filter(isRealPoint);

    for (const pt of pts) {
      const px = worldToPixel({ x: pt.x, y: pt.y, z: 0 }, cal);
      if (px.x < -80 || px.x > CANVAS_SIZE + 80 || px.y < -80 || px.y > CANVAS_SIZE + 80) continue;

      const gradient = ctx.createRadialGradient(px.x, px.y, 0, px.x, px.y, 60);
      gradient.addColorStop(0, config.color);
      gradient.addColorStop(0.5, config.lightColor);
      gradient.addColorStop(1, "rgba(0,0,0,0)");

      ctx.fillStyle = gradient;
      ctx.fillRect(px.x - 60, px.y - 60, 120, 120);
    }
  }, [cal, mode, points]);

  // 各模式的有效点数（过滤掉退化的原点坐标）
  const realCounts = useMemo(
    () =>
      Object.fromEntries(
        (Object.keys(MODE_CONFIG) as HeatmapMode[]).map((m) => [
          m,
          points[m].filter(isRealPoint).length,
        ]),
      ) as Record<HeatmapMode, number>,
    [points],
  );

  // 当所有模式都无有效坐标时，不渲染热力图——避免把所有原点坐标堆成一个红圈误导
  const hasAnyData = Object.values(realCounts).some((n) => n > 0);

  useEffect(() => {
    drawHeatmap();
  }, [drawHeatmap]);

  if (!cal) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-[var(--color-fg-dim)]">
        No calibration data for this map
      </div>
    );
  }

  if (!hasAnyData) {
    return (
      <div className="flex flex-col items-center justify-center gap-1 h-32 text-sm text-[var(--color-fg-dim)] text-center px-4">
        <span>暂无位置数据</span>
        <span className="text-xs text-[var(--color-fg-muted)]">
          当前 demo 导出未包含击杀坐标
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2 flex-wrap" role="radiogroup" aria-label="Heatmap filter mode">
        {(Object.keys(MODE_CONFIG) as HeatmapMode[]).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            onClick={() => setMode(m)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setMode(m);
              }
            }}
            className={cn(
              "px-3 py-1 text-xs rounded-full border transition-colors",
              mode === m
                ? "bg-[var(--color-accent)] text-white border-[var(--color-accent)]"
                : "bg-transparent text-[var(--color-fg-mid)] border-[var(--color-border)] hover:border-[var(--color-accent)]",
            )}
          >
            {MODE_CONFIG[m].label} ({realCounts[m]})
          </button>
        ))}
      </div>

      <div ref={containerRef} className="relative w-full max-w-[600px] aspect-square">
        <img
          src={cal.radar}
          alt={`${mapName} radar`}
          className="absolute inset-0 w-full h-full object-contain"
          style={{ imageRendering: "pixelated" }}
        />
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ pointerEvents: "none" }}
        />
      </div>
    </div>
  );
}
