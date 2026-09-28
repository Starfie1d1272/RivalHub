"use client";
import React from "react";
import { TeamLogo } from "@/components/teams/TeamLogo";
import { SIMULATION_SOURCE_LABELS } from "@/lib/predictions/presentation";
import type { Baseline, SimMatch } from "@/lib/predictions/types";
export function SimulationMatchCard({ match, stageKey, teams, busy, editable, compact = false, onChoose }: {
  match: SimMatch;
  stageKey: string;
  teams: ReadonlyMap<string, Baseline["teams"][number]>;
  busy: boolean;
  editable: boolean;
  compact?: boolean;
  onChoose: (match: SimMatch, winner: string) => void;
}) {
  const preview = match.source === "preview";
  const description = `${SIMULATION_SOURCE_LABELS[match.source]} · ${match.format.toUpperCase()}`;
  return (
    <div data-testid={`sim-match-${stageKey}-${match.key}`} data-source={match.source}
      title={description}
      className={`relative overflow-hidden border bg-[var(--color-panel-hi)] ${preview ? "border-dashed border-[var(--color-border)]" : match.source === "assumption" ? "border-[var(--color-accent)]" : "border-[var(--color-border)]"}`}>
      <span className="sr-only">{description}</span>
      <div className={compact ? "grid grid-cols-2 divide-x divide-[var(--color-border)]" : "divide-y divide-[var(--color-border)]"}>
        {[match.a, match.b].map((id, index) => {
          const team = teams.get(id);
          const selected = match.winner === id && !preview;
          const score = index === 0 ? match.scoreA : match.scoreB;
          return (
            <button key={id} type="button" aria-label={`${team?.name ?? "队伍"} 获胜${preview && match.winner === id ? " · 系统预览晋级" : ""}`}
              aria-pressed={selected} disabled={busy || !editable}
              onClick={() => onChoose(match, id)}
              className={`flex min-h-11 w-full min-w-0 items-center gap-2 px-2 text-xs focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-accent)] disabled:cursor-default ${selected ? "bg-[var(--color-accent)]/15" : "hover:bg-[var(--color-panel)]"}`}>
              <TeamLogo teamName={team?.name ?? "队伍"} logoUrl={team?.logoUrl ?? null} className="h-6 w-6 shrink-0" />
              <span className="truncate text-left font-medium">{team?.name ?? "队伍"}</span>
              <strong className="ml-auto shrink-0 font-mono tabular-nums">{score ?? (selected ? "✓" : preview && match.winner === id ? "↗" : "·")}</strong>
            </button>
          );
        })}
      </div>
    </div>
  );
}
