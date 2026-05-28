"use client";

import React, { useRef, useEffect, useState, useCallback } from "react";
import { cn } from "@/lib/utils/cn";
import { getCalibration, worldToPixel } from "@/lib/demo/map-calibration";
import type { DemoPoint } from "@/actions/demo-detail";

type HeatmapMode = "kills" | "deaths" | "bombs" | "grenades";

const MODE_CONFIG: Record<HeatmapMode, { label: string; color: string; lightColor: string }> = {
  kills: { label: "Kills", color: "rgba(255,50,50,0.35)", lightColor: "rgba(255,100,100,0.12)" },
  deaths: { label: "Deaths", color: "rgba(255,180,50,0.30)", lightColor: "rgba(255,200,80,0.10)" },
  bombs: { label: "Bombs", color: "rgba(50,130,255,0.35)", lightColor: "rgba(80,150,255,0.12)" },
  grenades: { label: "Grenades", color: "rgba(180,50,255,0.30)", lightColor: "rgba(200,80,255,0.10)" },
};

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
  const [imgSize, setImgSize] = useState({ w: 1024, h: 1024 });

  const cal = getCalibration(mapName);

  const drawHeatmap = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { w, h } = imgSize;
    canvas.width = w;
    canvas.height = h;

    ctx.clearRect(0, 0, w, h);

    if (!cal) return;

    const config = MODE_CONFIG[mode];
    const pts = points[mode];

    for (const pt of pts) {
      const px = worldToPixel({ x: pt.x, y: pt.y, z: 0 }, cal);
      if (px.x < -50 || px.x > w + 50 || px.y < -50 || px.y > h + 50) continue;

      const gradient = ctx.createRadialGradient(px.x, px.y, 0, px.x, px.y, 60);
      gradient.addColorStop(0, config.color);
      gradient.addColorStop(0.5, config.lightColor);
      gradient.addColorStop(1, "rgba(0,0,0,0)");

      ctx.fillStyle = gradient;
      ctx.fillRect(px.x - 60, px.y - 60, 120, 120);
    }
  }, [cal, mode, points, imgSize]);

  // 当所有模式都无数据时，不渲染热力图——避免显示空雷达图让人困惑
  const hasAnyData = Object.values(points).some((pts) => pts.length > 0);

  useEffect(() => {
    drawHeatmap();
  }, [drawHeatmap]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const rect = entry.contentRect;
        const size = Math.min(rect.width, 1024);
        setImgSize({ w: size, h: size });
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  if (!cal) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-[var(--color-fg-dim)]">
        No calibration data for this map
      </div>
    );
  }

  if (!hasAnyData) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-[var(--color-fg-dim)]">
        No heatmap data available
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
            {MODE_CONFIG[m].label} ({points[m].length})
          </button>
        ))}
      </div>

      <div ref={containerRef} className="relative w-full max-w-[1024px] aspect-square">
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
