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
  type ReadIdentity = { summary: Summary; attempt: number; seasonId: string; matchId: string };
  const [data, setData] = useState<(ReadIdentity & { value: { review: AdminDemoReviewMap; quality: AdminDemoQuality } }) | null>(null);
  const [failure, setFailure] = useState<(ReadIdentity & { message: string }) | null>(null);
  const isCurrent = (read: ReadIdentity | null) => read?.summary === summary && read.attempt === attempt && read.seasonId === seasonId && read.matchId === matchId;
  const fresh = isCurrent(data) && !isCurrent(failure);
  const error = isCurrent(failure) ? failure!.message : null;
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const identity = { summary, attempt, seasonId, matchId };
    // New RSC summary identity after a mutation refresh rechecks the visible review.
    void readMatchDemoReview({ seasonId, matchId, mapId: summary.matchMapId, importId: summary.importId }).then(result => {
      if (cancelled) return;
      if (result.success) { setData({ ...identity, value: result.data }); setFailure(null); }
      else setFailure({ ...identity, message: result.error.message });
    }).catch(() => { if (!cancelled) setFailure({ ...identity, message: "暂时无法读取待处理详情，请重试。" }); });
    return () => { cancelled = true; };
  }, [active, attempt, matchId, seasonId, summary]);
  return <details id={`demo-review-${summary.matchMapId}`} className="rounded border border-[var(--color-border)] p-3 text-sm"
    onToggle={event => { if (event.currentTarget.open) setActive(true); }}>
    <summary className="cursor-pointer">第 {summary.mapOrder} 图 · {mapLabel(summary.mapName)} · Demo 需要处理 · 查看核对详情</summary>
    {active && !fresh && !error && <p role="status">正在读取待处理详情…{data ? "上次核对内容暂不可操作，未保存草稿已保留。" : ""}</p>}
    {error && <p role="alert">{error}<Button variant="outline" size="sm" onClick={() => setAttempt(value => value + 1)}>重试</Button></p>}
    {data && <fieldset disabled={!fresh} aria-busy={!fresh && !error} className="min-w-0"><ReviewPanel reviews={[data.value.review]} quality={[data.value.quality]} /></fieldset>}
  </details>;
}
