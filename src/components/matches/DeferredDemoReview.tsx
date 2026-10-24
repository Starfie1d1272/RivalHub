"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { readMatchDemoReview } from "@/app/admin/[seasonSlug]/matches/actions";
import type { AdminDemoQuality } from "@/lib/admin/matches/demo-quality";
import type { AdminDemoReviewMap } from "@/lib/admin/matches/types";
import { Button } from "@/components/ui/button";
import { mapLabel } from "@/lib/maps";

const ReviewPanel = dynamic(() => import("./DemoDataReviewPanel").then(module => module.DemoDataReviewPanel));
type Summary = Pick<AdminDemoQuality, "importId" | "matchMapId" | "mapOrder" | "mapName">;

export function DeferredDemoReview({ seasonId, matchId, summary }: { seasonId: string; matchId: string; summary: Summary }) {
  const [active, setActive] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [data, setData] = useState<{ review: AdminDemoReviewMap; quality: AdminDemoQuality } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    // New RSC summary identity after a mutation refresh rechecks the visible review.
    void readMatchDemoReview({ seasonId, matchId, mapId: summary.matchMapId, importId: summary.importId }).then(result => {
      if (cancelled) return;
      if (result.success) { setData(result.data); setError(null); }
      else setError(result.error.message);
    }).catch(() => { if (!cancelled) setError("暂时无法读取待处理详情，请重试。"); });
    return () => { cancelled = true; };
  }, [active, attempt, matchId, seasonId, summary]);
  return <details id={`demo-review-${summary.matchMapId}`} className="rounded border border-[var(--color-border)] p-3 text-sm"
    onToggle={event => { if (event.currentTarget.open) setActive(true); }}>
    <summary className="cursor-pointer">第 {summary.mapOrder} 图 · {mapLabel(summary.mapName)} · Demo 需要处理 · 查看核对详情</summary>
    {active && !data && !error && <p role="status">正在读取待处理详情…</p>}
    {error && <p role="alert">{error}<Button variant="outline" size="sm" onClick={() => setAttempt(value => value + 1)}>重试</Button></p>}
    {data && <ReviewPanel reviews={[data.review]} quality={[data.quality]} />}
  </details>;
}
