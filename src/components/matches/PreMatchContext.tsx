"use client";

import React, { useState } from "react";
import { useMatchLive } from "./MatchLiveProvider";
import { visibleLiveSnapshot } from "@/lib/mizar/live-viewer-state";
import type { MatchPresentationPhase } from "@/lib/matches/presentation-phase";

/** Missing telemetry must not hide the canonical pre-match page. */
export function PreMatchContext({ phase, currentMapId, children }: {
  phase: MatchPresentationPhase;
  currentMapId: string | null;
  children: React.ReactNode;
}) {
  const { state, now } = useMatchLive();
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const hasLive = visibleLiveSnapshot(state, now, phase, currentMapId) !== null;
  const open = !hasLive || expanded === true;
  return <section className="space-y-5" aria-label="阵容与赛前资料">
    {hasLive && <button type="button" aria-expanded={open} onClick={() => setExpanded(!open)} className="flex min-h-10 w-full items-center justify-between border-t border-[var(--color-border)] pt-3 text-left text-sm font-medium text-[var(--color-fg-mid)]">
      阵容与赛前资料<span aria-hidden="true">{open ? "−" : "+"}</span>
    </button>}
    <div hidden={!open} className="space-y-8">{children}</div>
  </section>;
}
