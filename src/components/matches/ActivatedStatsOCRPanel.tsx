"use client";

import { useState, type ReactNode } from "react";
import dynamic from "next/dynamic";

const StatsOCRPanel = dynamic(() => import("./StatsOCRPanel").then(module => module.StatsOCRPanel));

/** Closing a map keeps the editor mounted so unsaved screenshots and drafts survive. */
export function ActivatedStatsOCRPanel({ mapId, mapName, initiallyOpen, summary, children }: {
  mapId: string;
  mapName: string;
  initiallyOpen: boolean;
  summary: ReactNode;
  children?: ReactNode;
}) {
  const [activated, setActivated] = useState(initiallyOpen);
  return <details id={`scoreboard-${mapId}`} open={initiallyOpen}
    onToggle={event => { if (event.currentTarget.open) setActivated(true); }}
    className="rounded border border-[var(--color-border)] p-3">
    <summary className="cursor-pointer text-sm">{summary}</summary>
    {activated && <div className="mt-3"><StatsOCRPanel mapId={mapId} mapName={mapName} /></div>}
    {children}
  </details>;
}
