"use client";

import React, { useState } from "react";
import type { MatchPresentationPhase } from "@/lib/matches/presentation-phase";

/** Missing telemetry must not hide the canonical pre-match page. */
export function PreMatchContext({ children }: {
  phase: MatchPresentationPhase;
  currentMapId: string | null;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);
  const open = expanded;
  return <section className="space-y-5" aria-label="阵容与赛前资料">
    <button type="button" aria-expanded={open} onClick={() => setExpanded(!open)} className="flex min-h-10 w-full items-center justify-between border-t border-[var(--color-border)] pt-3 text-left text-sm font-medium text-[var(--color-fg-mid)]">
      阵容与赛前资料<span aria-hidden="true">{open ? "−" : "+"}</span>
    </button>
    <div hidden={!open} className="space-y-8">{children}</div>
  </section>;
}
