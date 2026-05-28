"use client";

import React, { useRef, useEffect, useState, useCallback } from "react";
import { getCalibration, worldToPixel } from "@/lib/demo/map-calibration";
import type { DemoPoint } from "@/actions/demo-detail";

/** 热力图显示模式 */
type HeatmapMode = "kills" | "deaths" | "bombs" | "grenades";

const MODE_CONFIG: Record<HeatmapMode, { label: string; color: string; lightColor: string }> = {
  kills: { label: "击杀", color: "rgba(255,50,50,0.35)", lightColor: "rgba(255,100,100,0.12)" },
  deaths: { label: "死亡", color: "rgba(255,180,50,0.30)", lightColor: "rgba(255,200,80,0.10)" },
  bombs: { label: "炸弹", color: "rgba(50,130,255,0.35)", lightColor: "rgba(80,150,255,0.12)" },
  grenades: { label: "道具", color: "rgba(180,50,255,0.30)", lightColor: "rgba(200,80,255,0.10)" },
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
 * 静态热力图组件。
 * 在 radar 底图上用 Canvas 绘制半透明径向渐变点。
 * 提供 mode 切换按钮（击杀/死亡/炸弹/道具）。
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
      // 跳过超出画布的点（留 50px 边缘容差）
      if (px.x < -50 || px.x > w + 50 || px.y < -50 || px.y > h + 50) continue;

      const gradient = ctx.createRadialGradient(px.x, px.y, 0, px.x, px.y, 60);
      gradient.addColorStop(0, config.color);
      gradient.addColorStop(0.5, config.lightColor);
      gradient.addColorStop(1, "rgba(0,0,0,0)");

      ctx.fillStyle = gradient;
      ctx.fillRect(px.x - 60, px.y - 60, 120, 120);
    }
  }, [cal, mode, points, imgSize]);

  useEffect(() => {
    drawHeatmap();
  }, [drawHeatmap]);

  // 响应式缩放：canvas 撑满容器
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
        该地图暂无标定
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* mode 切换按钮 */}
      <div className="flex gap-2 flex-wrap">
        {(Object.keys(MODE_CONFIG) as HeatmapMode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`px-3 py-1 text-xs rounded-full border transition-colors ${
              mode === m
                ? "bg-[var(--color-accent)] text-white border-[var(--color-accent)]"
                : "bg-transparent text-[var(--color-fg-mid)] border-[var(--color-border)] hover:border-[var(--color-accent)]"
            }`}
          >
            {MODE_CONFIG[m].label} ({points[m].length})
          </button>
        ))}
      </div>

      {/* radar 底图 + Canvas */}
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
