"use client";

import { useRef, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { readMatchDemoQuality } from "@/app/admin/[seasonSlug]/matches/actions";
import type { AdminDemoQuality } from "@/lib/admin/matches/demo-quality";
import { Button } from "@/components/ui/button";
import { mapLabel } from "@/lib/maps";

const DemoQualityDetails = dynamic(() => import("./DemoDataReviewPanel").then(module => module.DemoQualityDetails));

export function DeferredDemoQuality({ seasonId, matchId, summary }: {
  seasonId: string; matchId: string;
  summary: Pick<AdminDemoQuality, "importId" | "matchMapId" | "mapOrder" | "mapName">;
}) {
  const [data, setData] = useState<AdminDemoQuality | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(false);
  function load() {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    startTransition(async () => {
      try {
        const result = await readMatchDemoQuality({ seasonId, matchId, mapId: summary.matchMapId, importId: summary.importId });
        if (result.success) setData(result.data);
        else setError(result.error.message);
      } catch { setError("暂时无法读取质量详情，请重试。"); }
      finally { inFlight.current = false; }
    });
  }
  return <details className="rounded border border-[var(--color-border)] p-3 text-sm"
    onToggle={event => { if (event.currentTarget.open && data === null && !error) load(); }}>
    <summary className="cursor-pointer">第 {summary.mapOrder} 图 · {mapLabel(summary.mapName)} · Demo 已确认 · {data?.summary ?? "查看质量详情"}</summary>
    {pending && <p role="status" className="mt-3">正在读取质量详情…</p>}
    {error && <p role="alert" className="mt-3">{error}<Button onClick={load} variant="outline" size="sm">重试</Button></p>}
    {data && <DemoQualityDetails item={data} />}
  </details>;
}
